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
import { resolveDeviceId } from "./deviceId";

export interface ConfigCheckWiringConfig {
  readonly manifestUrl: string;
  readonly intervalMs?: number;
  readonly onSync: (manifest: DistributionManifest) => Promise<void>;
  readonly onPollError?: (error: Error) => void;
  readonly startConfigCheckPollerFn?: typeof startConfigCheckPoller;
  readonly fetchImpl?: typeof fetch;
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
  readonly fetchImpl?: typeof fetch;
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

function resolveTargetVersion(
  manifest: DistributionManifest,
  bundleName?: string,
): string | undefined {
  if (bundleName !== undefined) {
    return manifest.bundles[bundleName]?.version;
  }

  const versions = [...new Set(Object.values(manifest.bundles).map((bundle) => bundle.version))];
  // No bundles: undefined. One version: that version.
  if (versions.length <= 1) {
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
    ...withOptionalValue("fetchImpl", config.fetchImpl),
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
    // A manifest with no bundles revokes everything; there is nothing to sync.
    const nothingToSync = getBundleNames(manifest).length === 0;

    let syncOk = nothingToSync;
    let reconcileOk = false;

    if (!nothingToSync) {
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
      }

      if (targetVersion === undefined) {
        logger.warn(
          "configCheckWiring: skipping skill sync because no target version could be resolved.",
        );
      } else {
        try {
          const syncResult = await syncSkillsFn({
            ...config.syncConfig,
            targetVersion,
          });

          if (syncResult.status === "success") {
            syncOk = true;
          } else if (syncResult.status === "offline") {
            logger.warn(
              `configCheckWiring: skill sync is offline for ${targetVersion}.`,
            );
          } else {
            logger.error(
              `configCheckWiring: skill sync returned ${syncResult.status}.`,
            );
          }
        } catch (error: unknown) {
          logger.error(
            `configCheckWiring: skill sync failed: ${formatError(error)}`,
          );
        }
      }
    }

    // Removals never depend on synced skill files, so they are applied on
    // every cycle. Additions, updates and moves wait for a successful sync.
    try {
      const reconcileResult = await reconcileFn(
        manifest,
        syncOk
          ? config.reconcileConfig
          : { ...config.reconcileConfig, removalsOnly: true },
      );

      if (reconcileResult.status === "rolled_back") {
        logger.error(
          `configCheckWiring: reconcile rolled back: ${reconcileResult.error ?? "unknown error"}`,
        );
      } else if (reconcileResult.status === "error") {
        logger.error(
          `configCheckWiring: reconcile failed: ${reconcileResult.error ?? "unknown error"}`,
        );
      } else {
        reconcileOk = true;
      }
    } catch (error: unknown) {
      logger.error(
        `configCheckWiring: reconcile threw: ${formatError(error)}`,
      );
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

    if (!syncOk || !reconcileOk) {
      // Rejecting tells the poller this manifest is not finished. The poller
      // keeps the old content hash and calls this handler again next tick.
      throw new Error(
        `configCheckWiring: managed tooling update incomplete (skill sync ${syncOk ? "ok" : "failed"}, reconcile ${reconcileOk ? "ok" : "failed"}); will retry.`,
      );
    }

    // Only a finished cycle replaces the earlier manifest. A retry must see
    // the same earlier manifest as the first attempt: it is the only source
    // of a sync version when the new manifest dropped the configured bundle.
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

const DEVICE_ID_MAX_LENGTH = 128;
const HEADER_TOKEN_PATTERN = /^[\x21-\x7e]+$/;

export interface AuthenticatedFetchOptions {
  readonly token: string | undefined;
  readonly deviceId?: string;
  readonly fetchFn?: typeof fetch;
}

/**
 * Wraps fetch so manifest polls send the user's API token as a bearer
 * credential. Returns undefined when there is no usable token, so the caller
 * keeps the unauthenticated behavior. The token is never logged or put in an
 * error message or URL.
 */
export function createAuthenticatedFetch(
  options: AuthenticatedFetchOptions,
): typeof fetch | undefined {
  const { token, deviceId } = options;
  if (token === undefined || !HEADER_TOKEN_PATTERN.test(token)) {
    return undefined;
  }

  const sendDeviceId =
    deviceId !== undefined &&
    deviceId !== "" &&
    deviceId.length <= DEVICE_ID_MAX_LENGTH &&
    HEADER_TOKEN_PATTERN.test(deviceId);

  return (input, init) => {
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    if (sendDeviceId && !headers.has("X-Joyus-Device-Id")) {
      headers.set("X-Joyus-Device-Id", deviceId);
    }

    return (options.fetchFn ?? fetch)(input, { ...init, headers });
  };
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseUrl(value: string | undefined): URL | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }

  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/**
 * Returns the reason the API token must not be sent to the manifest URL, or
 * undefined when it may be. The token is the control-plane credential, so it
 * goes only to the control-plane origin, over https (or loopback http).
 * Reasons carry origins at most, never full URLs or the token.
 */
function getTokenWithholdReason(
  manifestUrl: string,
  apiUrl: string | undefined,
): string | undefined {
  const api = parseUrl(apiUrl);
  if (api === undefined) {
    return "JOYUS_API_URL is unset or not a valid URL";
  }

  const manifest = parseUrl(manifestUrl);
  if (manifest === undefined || manifest.origin !== api.origin) {
    return "manifest URL origin differs from JOYUS_API_URL";
  }

  const isHttps = manifest.protocol === "https:";
  const isLoopbackHttp =
    manifest.protocol === "http:" && LOOPBACK_HOSTS.has(manifest.hostname);
  if (!isHttps && !isLoopbackHttp) {
    return `origin ${manifest.origin} is not https or loopback http`;
  }

  return undefined;
}

/**
 * Supplies the `X-Joyus-Device-Id` value, or undefined for no header. The
 * default persists a UUID (see `deviceId.ts`); tests inject a stand-in.
 */
export type DeviceIdResolver = (
  env: NodeJS.ProcessEnv,
  logger: ConfigChangeHandlerLogger,
) => string | undefined;

const defaultDeviceIdResolver: DeviceIdResolver = (env, logger) =>
  resolveDeviceId({ env, logger });

function resolveManifestFetch(
  env: NodeJS.ProcessEnv,
  manifestUrl: string,
  logger: ConfigChangeHandlerLogger,
  deviceIdResolver: DeviceIdResolver,
): typeof fetch | undefined {
  const token = env["JOYUS_API_TOKEN"];
  if (token === undefined || token === "") {
    return undefined;
  }

  const reason = getTokenWithholdReason(manifestUrl, env["JOYUS_API_URL"]);
  if (reason !== undefined) {
    logger.warn(`configCheckWiring: ${reason}; not sending API token.`);
    return undefined;
  }

  // Resolved only once the token is known to be sent, so an unmanaged or
  // misconfigured desktop never creates a device-id file.
  return createAuthenticatedFetch({
    token,
    ...withOptionalValue("deviceId", deviceIdResolver(env, logger)),
  });
}

/**
 * `deviceIdResolver` exists so tests can pin the device id without touching
 * the filesystem; production callers leave the default.
 */
export function resolveSidecarManagedToolingConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  logger: ConfigChangeHandlerLogger = NOOP_LOGGER,
  deviceIdResolver: DeviceIdResolver = defaultDeviceIdResolver,
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
  const fetchImpl = resolveManifestFetch(
    env,
    manifestUrl,
    logger,
    deviceIdResolver,
  );

  return {
    manifestUrl,
    ...withOptionalValue("intervalMs", intervalMs),
    ...withOptionalValue("fetchImpl", fetchImpl),
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
