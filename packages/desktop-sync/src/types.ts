export interface SyncConfig {
  repoUrl: string;
  destDir: string;
  cacheDir: string;
  distributionConfigPath: string;
  bundleName: string;
  syncIntervalMs: number;
}

export interface SyncResult {
  version: string;
  syncedAt: string;
  fromCache: boolean;
  durationMs: number;
}

export interface SyncMetadata {
  version: string;
  syncedAt: string;
  lastCheckAt: string;
}

export type SyncStatus = "idle" | "syncing" | "synced" | "error";

export interface DesktopSyncDeps {
  execGit: (args: string[], cwd?: string) => Promise<{ stdout: string; stderr: string }>;
  readFile: (path: string, encoding: string) => Promise<string>;
  writeFile: (path: string, content: string, encoding: string) => Promise<void>;
  mkdir: (path: string, opts: { recursive: boolean }) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
  copyDir: (src: string, dest: string) => Promise<void>;
  now: () => string;
}
