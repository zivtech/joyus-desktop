import { syncSkills, type SyncConfig } from "@joyus/skill-sync";
import {
  aggregateTenantConfig,
  reconcile,
  resolveConfigPath,
  writeTenantConfig,
  type DistributionManifest,
  type ReconcileConfig,
} from "@joyus/settings-reconciler";
import { startConfigCheckPoller, type PollerHandle } from "./configCheckPoller";

export interface ConfigCheckWiringConfig {
  readonly manifestUrl: string;
  readonly intervalMs?: number;
  readonly onSync: (manifest: DistributionManifest) => Promise<void>;
  readonly onPollError?: (error: Error) => void;
  readonly startConfigCheckPollerFn?: typeof startConfigCheckPoller;
}

export interface ManagedToolingSyncConfig
  extends Omit<SyncConfig, "targetVersion"> {
  readonly bundleName?: string;
}

export interface ConfigChangeHandlerLogger {
  readonly error: (message: string) => void;
  readonly warn: (message: string) => void;
}

export interface ConfigChangeHandlerConfig {
  readonly syncConfig: ManagedToolingSyncConfig;
  readonly reconcileConfig?: ReconcileConfig;
  readonly tenantConfigPath?: string;
  readonly logger?: ConfigChangeHandlerLogger;
  readonly initialManifest?: DistributionManifest;
  readonly syncSkillsFn?: typeof syncSkills;
  readonly reconcileFn?: typeof reconcile;
  readonly aggregateTenantConfigFn?: typeof aggregateTenantConfig;
  readonly resolveConfigPathFn?: typeof resolveConfigPath;
  readonly writeTenantConfigFn?: typeof writeTenantConfig;
}

export interface SidecarManagedToolingConfig extends ConfigChangeHandlerConfig {
  readonly manifestUrl: string;
  readonly intervalMs?: number;
}

const NOOP_LOGGER: ConfigChangeHandlerLogger = {
  error: () => undefined,
  warn: () => undefined,
};

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getBundleNames(manifest: DistributionManifest): string[] {
  return Object.keys(manifest.bundles).sort();
}

function getManagedEntryIds(manifest: DistributionManifest): Set<string> {
  const ids = new Set<string>();

  for (const bundle of Object.values(manifest.bundles)) {
    for (const hook of bundle.hooks ?? []) {
      ids.add(`hook:${hook.event}:${hook.matcher}`);
    }

    for (const server of bundle.mcpServers ?? []) {
      ids.add(`mcp:${server.id}`);
    }
  }

  return ids;
}

function hasRevocation(
  previousManifest: DistributionManifest | undefined,
  nextManifest: DistributionManifest,
): boolean {
  if (getBundleNames(nextManifest).length === 0) {
    return true;
  }

  if (previousManifest === undefined) {
    return false;
  }

  const nextBundles = new Set(getBundleNames(nextManifest));
  for (const bundleName of getBundleNames(previousManifest)) {
    if (!nextBundles.has(bundleName)) {
      return true;
    }
  }

  const nextEntries = getManagedEntryIds(nextManifest);
  for (const entryId of getManagedEntryIds(previousManifest)) {
    if (!nextEntries.has(entryId)) {
      return true;
    }
  }

  return false;
}

function resolveTargetVersion(
  manifest: DistributionManifest,
  bundleName?: string,
): string | undefined {
  if (bundleName !== undefined) {
    return manifest.bundles[bundleName]?.version;
  }

  const versions = [...new Set(Object.values(manifest.bundles).map((bundle) => bundle.version))];
  if (versions.length === 0) {
    return undefined;
  }

  if (versions.length === 1) {
    return versions[0];
  }

  throw new Error(
    "Unable to resolve skill-sync target version from manifest with multiple bundle versions; configure bundleName explicitly.",
  );
}

function resolveSyncTargetVersion(
  manifest: DistributionManifest,
  previousManifest: DistributionManifest | undefined,
  bundleName?: string,
): string | undefined {
  return (
    resolveTargetVersion(manifest, bundleName) ??
    (previousManifest !== undefined
      ? resolveTargetVersion(previousManifest, bundleName)
      : undefined)
  );
}

export function createConfigCheckWiring(
  config: ConfigCheckWiringConfig,
): PollerHandle {
  const startPoller =
    config.startConfigCheckPollerFn ?? startConfigCheckPoller;

  return startPoller({
    manifestUrl: config.manifestUrl,
    onChangeDetected: config.onSync,
    ...withOptionalValue("intervalMs", config.intervalMs),
    ...withOptionalValue("onPollError", config.onPollError),
  });
}

export function createConfigChangeHandler(
  config: ConfigChangeHandlerConfig,
): (manifest: DistributionManifest) => Promise<void> {
  const logger = config.logger ?? NOOP_LOGGER;
  const syncSkillsFn = config.syncSkillsFn ?? syncSkills;
  const reconcileFn = config.reconcileFn ?? reconcile;
  const aggregateTenantConfigFn =
    config.aggregateTenantConfigFn ?? aggregateTenantConfig;
  const resolveConfigPathFn =
    config.resolveConfigPathFn ?? resolveConfigPath;
  const writeTenantConfigFn =
    config.writeTenantConfigFn ?? writeTenantConfig;
  let lastManifest = config.initialManifest;

  return async (manifest: DistributionManifest): Promise<void> => {
    const previousManifest = lastManifest;
    const shouldReconcileForRevocation = hasRevocation(
      previousManifest,
      manifest,
    );

    let shouldAttemptReconcile = true;
    let targetVersion: string | undefined;

    try {
      targetVersion = resolveSyncTargetVersion(
        manifest,
        previousManifest,
        config.syncConfig.bundleName,
      );
    } catch (error: unknown) {
      logger.error(
        `configCheckWiring: ${formatError(error)}`,
      );
      shouldAttemptReconcile = shouldReconcileForRevocation;
    }

    if (targetVersion === undefined) {
      logger.warn(
        "configCheckWiring: skipping skill sync because no target version could be resolved.",
      );
      shouldAttemptReconcile = shouldReconcileForRevocation;
    } else {
      try {
        const syncResult = await syncSkillsFn({
          ...config.syncConfig,
          targetVersion,
        });

        if (syncResult.status === "offline") {
          logger.warn(
            `configCheckWiring: skill sync is offline for ${targetVersion}.`,
          );
          shouldAttemptReconcile = shouldReconcileForRevocation;
        } else if (syncResult.status !== "success") {
          logger.error(
            `configCheckWiring: skill sync returned ${syncResult.status}.`,
          );
          shouldAttemptReconcile = false;
        }
      } catch (error: unknown) {
        logger.error(
          `configCheckWiring: skill sync failed: ${formatError(error)}`,
        );
        shouldAttemptReconcile = false;
      }
    }

    if (shouldAttemptReconcile) {
      try {
        const reconcileResult = await reconcileFn(
          manifest,
          config.reconcileConfig,
        );

        if (reconcileResult.status === "rolled_back") {
          logger.error(
            `configCheckWiring: reconcile rolled back: ${reconcileResult.error ?? "unknown error"}`,
          );
        } else if (reconcileResult.status === "error") {
          logger.error(
            `configCheckWiring: reconcile failed: ${reconcileResult.error ?? "unknown error"}`,
          );
        }
      } catch (error: unknown) {
        logger.error(
          `configCheckWiring: reconcile threw: ${formatError(error)}`,
        );
      }
    }

    try {
      const tenantConfig = aggregateTenantConfigFn(manifest);
      const tenantConfigPath =
        config.tenantConfigPath ?? resolveConfigPathFn(manifest);
      await writeTenantConfigFn(tenantConfig, tenantConfigPath);
    } catch (error: unknown) {
      logger.error(
        `configCheckWiring: tenant config write failed: ${formatError(error)}`,
      );
    }

    lastManifest = manifest;
  };
}

function parseIntervalMs(rawValue: string | undefined): number | undefined {
  if (rawValue === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

function withOptionalValue<K extends string, V>(
  key: K,
  value: V | undefined,
): Partial<Record<K, V>> {
  if (value === undefined) {
    return {};
  }

  return { [key]: value } as Partial<Record<K, V>>;
}

export function resolveSidecarManagedToolingConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SidecarManagedToolingConfig | undefined {
  const manifestUrl = env["JOYUS_MANAGED_TOOLING_MANIFEST_URL"];
  const repoUrl = env["SKILL_SYNC_REPO_URL"];

  if (
    manifestUrl === undefined ||
    manifestUrl === "" ||
    repoUrl === undefined ||
    repoUrl === ""
  ) {
    return undefined;
  }

  const intervalMs = parseIntervalMs(env["JOYUS_MANAGED_TOOLING_INTERVAL_MS"]);

  return {
    manifestUrl,
    ...withOptionalValue("intervalMs", intervalMs),
    syncConfig: {
      repoUrl,
      destDir: env["SKILL_SYNC_DEST_DIR"] ?? "~/.claude/skills",
      cacheDir:
        env["SKILL_SYNC_CACHE_DIR"] ?? "~/.claude/.skill-sync-cache",
      ...withOptionalValue("bundleName", env["SKILL_SYNC_BUNDLE"]),
    },
    reconcileConfig: {
      ...withOptionalValue(
        "globalSettingsPath",
        env["JOYUS_MANAGED_TOOLING_GLOBAL_SETTINGS_PATH"],
      ),
      ...withOptionalValue(
        "projectSettingsPath",
        env["JOYUS_MANAGED_TOOLING_PROJECT_SETTINGS_PATH"],
      ),
      ...withOptionalValue(
        "registryPath",
        env["JOYUS_MANAGED_TOOLING_REGISTRY_PATH"],
      ),
      ...withOptionalValue(
        "backupDir",
        env["JOYUS_MANAGED_TOOLING_BACKUP_DIR"],
      ),
    },
    ...withOptionalValue(
      "tenantConfigPath",
      env["JOYUS_MANAGED_TOOLING_TENANT_CONFIG_PATH"],
    ),
  };
}
