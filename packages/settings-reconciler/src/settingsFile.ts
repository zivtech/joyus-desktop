import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function readSettingsFile(path: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(path, "utf8");
    if (raw.trim() === "") {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return {};
    }
    // Corrupted JSON or other read errors
    return {};
  }
}

export async function writeSettingsFile(
  path: string,
  settings: Record<string, unknown>
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
  await rename(tmpPath, path);
}

export async function createSettingsBackup(
  settingsPath: string,
  backupDir: string,
  maxBackups: number,
  now: () => Date = () => new Date()
): Promise<string | undefined> {
  try {
    await readFile(settingsPath);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }

  await mkdir(backupDir, { recursive: true });

  const timestamp = now().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(backupDir, `${timestamp}-settings.json`);
  await copyFile(settingsPath, backupPath);

  const entries = await readdir(backupDir);
  const backupFiles = entries
    .filter((name) => name.endsWith("-settings.json"))
    .sort();

  const overflow = backupFiles.length - maxBackups;
  if (overflow > 0) {
    for (const fileName of backupFiles.slice(0, overflow)) {
      await rm(join(backupDir, fileName), { force: true });
    }
  }

  return backupPath;
}

export async function rollbackSettings(
  settingsPath: string,
  backupPath: string
): Promise<void> {
  let backupContent: string;
  try {
    backupContent = await readFile(backupPath, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }
    throw error;
  }

  await mkdir(dirname(settingsPath), { recursive: true });
  const tmpPath = `${settingsPath}.tmp`;
  await writeFile(tmpPath, backupContent, "utf8");
  await rename(tmpPath, settingsPath);
}
