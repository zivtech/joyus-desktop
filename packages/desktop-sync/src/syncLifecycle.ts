import type { DesktopSyncDeps, SyncConfig, SyncResult, SyncStatus } from "./types";
import { cloneOrUpdate, copySkillsAtomic, ensureCloneDir } from "./cloneManager";
import { hasVersionChanged, readVersionPin, updateSyncMetadata } from "./versionPin";

async function performSync(config: SyncConfig, deps: DesktopSyncDeps): Promise<SyncResult> {
  const startTime = Date.now();
  const targetVersion = await readVersionPin(
    config.distributionConfigPath,
    config.bundleName,
    deps
  );

  await ensureCloneDir(config.cacheDir, deps);

  const metadataPath = `${config.cacheDir}/.sync-metadata.json`;
  let fromCache = false;

  try {
    const raw = await deps.readFile(metadataPath, "utf-8");
    const existing: unknown = JSON.parse(raw);
    if (
      typeof existing === "object" &&
      existing !== null &&
      "version" in existing &&
      typeof (existing as Record<string, unknown>)["version"] === "string" &&
      !hasVersionChanged((existing as Record<string, string>)["version"], targetVersion)
    ) {
      fromCache = true;
    }
  } catch {
    // No metadata yet — first sync
  }

  if (!fromCache) {
    await cloneOrUpdate(config.repoUrl, config.cacheDir, targetVersion, deps);
    await copySkillsAtomic(config.cacheDir, config.destDir, deps);
  }

  const syncedAt = deps.now();
  await updateSyncMetadata(metadataPath, targetVersion, deps);

  return {
    version: targetVersion,
    syncedAt,
    fromCache,
    durationMs: Date.now() - startTime,
  };
}

export async function startupSync(
  config: SyncConfig,
  deps: DesktopSyncDeps
): Promise<SyncResult> {
  return performSync(config, deps);
}

export interface PeriodicSync {
  start: () => void;
  stop: () => void;
  getStatus: () => SyncStatus;
}

export function createPeriodicSync(
  config: SyncConfig,
  deps: DesktopSyncDeps
): PeriodicSync {
  let status: SyncStatus = "idle";
  let timerId: ReturnType<typeof setInterval> | undefined;
  let syncing = false;

  async function tick(): Promise<void> {
    if (syncing) {
      return;
    }
    syncing = true;
    status = "syncing";
    try {
      await performSync(config, deps);
      status = "synced";
    } catch {
      status = "error";
    } finally {
      syncing = false;
    }
  }

  return {
    start(): void {
      if (timerId !== undefined) {
        return;
      }
      status = "idle";
      timerId = setInterval(() => void tick(), config.syncIntervalMs);
    },
    stop(): void {
      if (timerId !== undefined) {
        clearInterval(timerId);
        timerId = undefined;
      }
      if (!syncing) {
        status = "idle";
      }
    },
    getStatus(): SyncStatus {
      return status;
    },
  };
}
