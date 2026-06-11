import type { DesktopSyncDeps } from "./types";

export async function ensureCloneDir(
  cacheDir: string,
  deps: Pick<DesktopSyncDeps, "mkdir">
): Promise<void> {
  await deps.mkdir(cacheDir, { recursive: true });
}

export async function cloneOrUpdate(
  repoUrl: string,
  cacheDir: string,
  targetVersion: string,
  deps: Pick<DesktopSyncDeps, "execGit" | "exists">
): Promise<void> {
  const gitDirExists = await deps.exists(`${cacheDir}/.git`);

  if (!gitDirExists) {
    await deps.execGit(
      ["clone", "--depth", "1", "--branch", targetVersion, repoUrl, cacheDir]
    );
  } else {
    await deps.execGit(
      ["fetch", "origin", "tag", targetVersion, "--depth", "1"],
      cacheDir
    );
    await deps.execGit(["checkout", targetVersion], cacheDir);
  }
}

export async function copySkillsAtomic(
  cacheDir: string,
  destDir: string,
  deps: Pick<DesktopSyncDeps, "copyDir" | "mkdir" | "exists">
): Promise<void> {
  const tempDir = `${destDir}.tmp`;
  await deps.mkdir(tempDir, { recursive: true });
  await deps.copyDir(`${cacheDir}/skills`, tempDir);

  const destExists = await deps.exists(destDir);
  if (destExists) {
    const backupDir = `${destDir}.bak`;
    await deps.copyDir(destDir, backupDir);
  }

  await deps.copyDir(tempDir, destDir);
}

export async function readCloneMetadata(
  cacheDir: string,
  deps: Pick<DesktopSyncDeps, "execGit">
): Promise<string> {
  const result = await deps.execGit(["describe", "--tags", "--exact-match"], cacheDir);
  return result.stdout.trim();
}

export async function isNetworkAvailable(
  repoUrl: string,
  deps: Pick<DesktopSyncDeps, "execGit">
): Promise<boolean> {
  try {
    await deps.execGit(["ls-remote", "--exit-code", repoUrl]);
    return true;
  } catch {
    return false;
  }
}
