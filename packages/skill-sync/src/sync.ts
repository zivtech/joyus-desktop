import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  rm,
  stat,
  unlink
} from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { homedir } from "node:os";
import { readSyncMetadata, writeSyncMetadata } from "./metadata";

const execFileAsync = promisify(execFile);
const OFFLINE_PATTERN = /(Could not resolve host|Failed to connect|Connection timed out|Network is unreachable|No route to host|Temporary failure in name resolution)/i;
const INVALID_REFERENCE_PATTERN = /(couldn't find remote ref|Remote branch .* not found|pathspec .* did not match|not a valid object name|invalid reference)/i;

export type SyncStatus = "success" | "offline" | "error" | "locked";

export interface SyncMetadata {
  lastAttempt?: string;
  lastSync?: string;
  lastSuccess?: string;
  version?: string;
  status: SyncStatus;
  repoUrl?: string;
  filesUpdated?: number;
  modifiedFilesOverwritten?: string[];
  backupPath?: string;
  warning?: string;
  error?: string;
  managedFiles: Record<string, string>;
}

export interface SyncConfig {
  repoUrl: string;
  targetVersion: string;
  destDir: string;
  cacheDir: string;
  metadataPath?: string;
  backupDir?: string;
  maxBackups?: number;
  gitBinary?: string;
  commandTimeoutMs?: number;
  lockRetries?: number;
  lockRetryDelayMs?: number;
  now?: () => Date;
  commandRunner?: (command: string, args: string[]) => Promise<void>;
}

export interface SyncResult {
  status: SyncStatus;
  filesUpdated: number;
  metadataPath: string;
  version?: string;
  noop: boolean;
  backupPath?: string;
}

interface LockHandle {
  release: () => Promise<void>;
}

export class GitCommandError extends Error {
  public readonly stderr: string;

  public constructor(message: string, stderr: string) {
    super(message);
    this.name = "GitCommandError";
    this.stderr = stderr;
  }
}

function withOptionalString<K extends string>(
  key: K,
  value: string | undefined
): Partial<Record<K, string>> {
  if (value === undefined) {
    return {};
  }

  return { [key]: value } as Partial<Record<K, string>>;
}

export function resolveHomePath(pathValue: string): string {
  if (pathValue === "~") {
    return homedir();
  }

  if (pathValue.startsWith("~/")) {
    return join(homedir(), pathValue.slice(2));
  }

  return pathValue;
}

function isoNow(clock: () => Date): string {
  return clock().toISOString();
}

function stampNow(clock: () => Date): string {
  return clock().toISOString().replace(/[.:]/g, "-");
}

async function exists(pathValue: string): Promise<boolean> {
  try {
    await stat(pathValue);
    return true;
  } catch {
    return false;
  }
}

async function hashFile(pathValue: string): Promise<string> {
  const buffer = await readFile(pathValue);
  return createHash("sha256").update(buffer).digest("hex");
}

async function collectFiles(rootDir: string): Promise<string[]> {
  const pending: string[] = [rootDir];
  const files: string[] = [];

  while (pending.length > 0) {
    const current = pending.pop() as string;

    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git") {
        continue;
      }

      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }

      files.push(fullPath);
    }
  }

  files.sort();
  return files;
}

function classifyGitError(stderr: string): "offline" | "invalid_reference" | "unknown" {
  if (OFFLINE_PATTERN.test(stderr)) {
    return "offline";
  }

  if (INVALID_REFERENCE_PATTERN.test(stderr)) {
    return "invalid_reference";
  }

  return "unknown";
}

async function acquireLock(pathValue: string, retries: number, retryDelayMs: number): Promise<LockHandle | undefined> {
  let attempts = 0;

  while (attempts <= retries) {
    try {
      const fileHandle = await open(pathValue, "wx");
      return {
        async release(): Promise<void> {
          await fileHandle.close();
          await rm(pathValue, { force: true });
        }
      };
    } catch (error) {
      const code = (error as { code?: string }).code;

      /* v8 ignore next 3 */
      if (code !== "EEXIST") {
        throw error;
      }

      if (attempts === retries) {
        return undefined;
      }

      attempts += 1;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}

async function runGitCommand(
  gitBinary: string,
  args: string[],
  timeoutMs: number,
  commandRunner?: (command: string, args: string[]) => Promise<void>
): Promise<void> {
  if (commandRunner) {
    await commandRunner(gitBinary, args);
    return;
  }

  try {
    await execFileAsync(gitBinary, args, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
  } catch (error) {
    const stderr = String((error as { stderr?: string }).stderr);
    throw new GitCommandError(`git ${args.join(" ")} failed`, stderr);
  }
}

async function createBackup(
  backupRoot: string,
  destDir: string,
  filesToBackup: string[],
  maxBackups: number,
  clock: () => Date
): Promise<string> {
  const backupPath = join(backupRoot, stampNow(clock));
  await mkdir(backupPath, { recursive: true });

  for (const relativePath of filesToBackup) {
    const sourcePath = join(destDir, relativePath);
    const targetPath = join(backupPath, relativePath);
    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
  }

  const backupDirs = (await readdir(backupRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const overflow = backupDirs.length - maxBackups;
  if (overflow > 0) {
    for (const dirName of backupDirs.slice(0, overflow)) {
      await rm(join(backupRoot, dirName), { recursive: true, force: true });
    }
  }

  return backupPath;
}

function isEqualRecord(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (const key of leftKeys) {
    if (left[key] !== right[key]) {
      return false;
    }
  }

  return true;
}

const SAFE_REPO_URL = /^(https?:\/\/|git@|ssh:\/\/|git:\/\/|file:\/\/|\/)/;
const SAFE_VERSION = /^[a-zA-Z0-9][a-zA-Z0-9._\-/]*$/;

function validateSyncInputs(repoUrl: string, targetVersion: string): void {
  if (!SAFE_REPO_URL.test(repoUrl)) {
    throw new Error(`Invalid repoUrl: must start with https://, git@, ssh://, or git://`);
  }
  if (!SAFE_VERSION.test(targetVersion)) {
    throw new Error(`Invalid targetVersion: must start with alphanumeric and contain only [a-zA-Z0-9._-/]`);
  }
}

export async function syncSkills(config: SyncConfig): Promise<SyncResult> {
  validateSyncInputs(config.repoUrl, config.targetVersion);
  const clock = config.now ?? (() => new Date());
  const destDir = resolveHomePath(config.destDir);
  const cacheDir = resolveHomePath(config.cacheDir);
  const backupDir = resolveHomePath(config.backupDir ?? "~/.claude/.skill-sync-backups");
  const metadataPath = resolveHomePath(config.metadataPath ?? join(destDir, ".sync-metadata.json"));
  const repoCacheDir = join(cacheDir, "repo");
  const lockPath = join(cacheDir, ".sync.lock");
  const maxBackups = config.maxBackups ?? 5;
  const gitBinary = config.gitBinary ?? "git";
  const commandTimeoutMs = config.commandTimeoutMs ?? 8_000;

  await mkdir(destDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  await mkdir(repoCacheDir, { recursive: true });

  const lock = await acquireLock(lockPath, config.lockRetries ?? 20, config.lockRetryDelayMs ?? 50);
  if (!lock) {
    const metadata = (await readSyncMetadata(metadataPath)) ?? { status: "locked", managedFiles: {} };
    metadata.status = "locked";
    metadata.lastAttempt = isoNow(clock);
    await writeSyncMetadata(metadataPath, metadata);
    return {
      status: "locked",
      filesUpdated: 0,
      metadataPath,
      noop: true,
      ...withOptionalString("version", metadata.version)
    };
  }

  const currentMetadata = (await readSyncMetadata(metadataPath)) ?? {
    status: "success" as const,
    managedFiles: {}
  };

  try {
    const hasGitCache = await exists(join(repoCacheDir, ".git"));

    try {
      if (!hasGitCache) {
        await rm(repoCacheDir, { recursive: true, force: true });
        await runGitCommand(gitBinary, ["clone", "--depth", "1", "--branch", config.targetVersion, config.repoUrl, repoCacheDir], commandTimeoutMs, config.commandRunner);
      } else if (
        currentMetadata.version !== config.targetVersion ||
        currentMetadata.repoUrl !== config.repoUrl
      ) {
        await runGitCommand(gitBinary, ["-C", repoCacheDir, "fetch", "--depth", "1", "origin", "tag", config.targetVersion], commandTimeoutMs, config.commandRunner);
        await runGitCommand(gitBinary, ["-C", repoCacheDir, "checkout", "--force", `tags/${config.targetVersion}`], commandTimeoutMs, config.commandRunner);
      }
    } catch (error) {
      if (error instanceof GitCommandError) {
        const kind = classifyGitError(error.stderr);
        if (kind === "offline") {
          const metadata: SyncMetadata = {
            ...currentMetadata,
            status: "offline",
            lastAttempt: isoNow(clock),
            warning: "Network unavailable; using last successful skill sync state",
            managedFiles: currentMetadata.managedFiles
          };
          await writeSyncMetadata(metadataPath, metadata);
          return {
            status: "offline",
            filesUpdated: 0,
            metadataPath,
            noop: true,
            ...withOptionalString("version", currentMetadata.version)
          };
        }

        if (kind === "invalid_reference") {
          throw new Error(`Invalid target version '${config.targetVersion}' in repo '${config.repoUrl}'`);
        }
      }

      throw error;
    }

    const sourceRootCandidate = join(repoCacheDir, "skills");
    const sourceRoot = await exists(sourceRootCandidate) ? sourceRootCandidate : repoCacheDir;
    const sourceFiles = await collectFiles(sourceRoot);

    const nextManagedFiles: Record<string, string> = {};
    for (const sourceFile of sourceFiles) {
      const relativePath = relative(sourceRoot, sourceFile);
      nextManagedFiles[relativePath] = await hashFile(sourceFile);
    }

    const modifiedFiles: string[] = [];
    for (const [relativePath, previousHash] of Object.entries(currentMetadata.managedFiles)) {
      const destinationPath = join(destDir, relativePath);
      if (!(await exists(destinationPath))) {
        continue;
      }

      const currentHash = await hashFile(destinationPath);
      if (currentHash !== previousHash) {
        modifiedFiles.push(relativePath);
      }
    }

    const staleFiles = Object.keys(currentMetadata.managedFiles).filter(
      (relativePath) => !(relativePath in nextManagedFiles)
    );
    const missingManagedDestinationFiles: string[] = [];
    for (const relativePath of Object.keys(nextManagedFiles)) {
      const destinationPath = join(destDir, relativePath);
      if (!(await exists(destinationPath))) {
        missingManagedDestinationFiles.push(relativePath);
      }
    }

    const unchangedVersion =
      currentMetadata.version === config.targetVersion &&
      currentMetadata.repoUrl === config.repoUrl;
    const perfectlySynced =
      unchangedVersion &&
      modifiedFiles.length === 0 &&
      staleFiles.length === 0 &&
      missingManagedDestinationFiles.length === 0 &&
      isEqualRecord(currentMetadata.managedFiles, nextManagedFiles);

    if (perfectlySynced) {
      const metadata: SyncMetadata = {
        ...currentMetadata,
        status: "success",
        lastAttempt: isoNow(clock),
        managedFiles: nextManagedFiles
      };
      await writeSyncMetadata(metadataPath, metadata);
      return {
        status: "success",
        filesUpdated: 0,
        metadataPath,
        version: config.targetVersion,
        noop: true
      };
    }

    let backupPath: string | undefined;
    if (modifiedFiles.length > 0) {
      await mkdir(backupDir, { recursive: true });
      backupPath = await createBackup(backupDir, destDir, modifiedFiles, maxBackups, clock);
    }

    for (const sourceFile of sourceFiles) {
      const relativePath = relative(sourceRoot, sourceFile);
      const destinationPath = join(destDir, relativePath);
      await mkdir(dirname(destinationPath), { recursive: true });
      await copyFile(sourceFile, destinationPath);
    }

    for (const staleFile of staleFiles) {
      await unlink(join(destDir, staleFile)).catch(() => undefined);
    }

    const timestamp = isoNow(clock);
    const metadataBase: SyncMetadata = {
      status: "success",
      lastAttempt: timestamp,
      lastSync: timestamp,
      lastSuccess: timestamp,
      version: config.targetVersion,
      repoUrl: config.repoUrl,
      filesUpdated: sourceFiles.length + staleFiles.length,
      modifiedFilesOverwritten: modifiedFiles,
      managedFiles: nextManagedFiles
    };
    const metadata: SyncMetadata = {
      ...metadataBase,
      ...withOptionalString("backupPath", backupPath),
      ...withOptionalString(
        "warning",
        modifiedFiles.length > 0
          ? `Local modifications to ${modifiedFiles.length} file(s) were overwritten`
          : undefined
      )
    };

    await writeSyncMetadata(metadataPath, metadata);

    return {
      status: "success",
      filesUpdated: sourceFiles.length + staleFiles.length,
      metadataPath,
      version: config.targetVersion,
      noop: false,
      ...withOptionalString("backupPath", backupPath)
    };
  } catch (error) {
    const metadata: SyncMetadata = {
      ...currentMetadata,
      status: "error",
      lastAttempt: isoNow(clock),
      error: error instanceof Error ? error.message : String(error),
      managedFiles: currentMetadata.managedFiles
    };
    await writeSyncMetadata(metadataPath, metadata);
    throw error;
  /* v8 ignore next */
  } finally {
    await lock.release();
  }
}
