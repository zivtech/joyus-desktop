import type { ServerManifest } from "./types";

export interface UpdateInfo {
  name: string;
  currentVersion: string;
  availableVersion: string;
}

export interface VersionCheckResponse {
  servers: Record<string, { latestVersion: string }>;
}

export type FetchVersionsFn = () => Promise<VersionCheckResponse>;

export interface UpdaterDeps {
  stopServer: (name: string) => Promise<void>;
  startServer: (name: string) => void;
  replaceVersion: (name: string, version: string) => Promise<void>;
  backupServer: (name: string) => Promise<string>;
  restoreBackup: (name: string, backupPath: string) => Promise<void>;
}

export function checkForUpdates(
  manifest: ServerManifest,
  remoteVersions: VersionCheckResponse,
): UpdateInfo[] {
  const updates: UpdateInfo[] = [];

  for (const [name, local] of Object.entries(manifest.servers)) {
    const remote = remoteVersions.servers[name];
    if (!remote) {
      continue;
    }

    const currentVersion = local.version ?? "0.0.0";
    if (remote.latestVersion !== currentVersion) {
      updates.push({
        name,
        currentVersion,
        availableVersion: remote.latestVersion,
      });
    }
  }

  return updates;
}

export async function applyUpdate(
  name: string,
  newVersion: string,
  deps: UpdaterDeps,
): Promise<boolean> {
  const backupPath = await deps.backupServer(name);

  try {
    await deps.stopServer(name);
    await deps.replaceVersion(name, newVersion);
    deps.startServer(name);
    return true;
  } catch {
    await rollback(name, backupPath, deps);
    return false;
  }
}

export async function rollback(
  name: string,
  backupPath: string,
  deps: UpdaterDeps,
): Promise<void> {
  try {
    await deps.stopServer(name);
  } catch {
    // Server may already be stopped
  }
  await deps.restoreBackup(name, backupPath);
  deps.startServer(name);
}
