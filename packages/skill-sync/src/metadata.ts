import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SyncMetadata } from "./sync";

export async function readSyncMetadata(path: string): Promise<SyncMetadata | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as SyncMetadata;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return undefined;
    }

    return undefined;
  }
}

export async function writeSyncMetadata(path: string, metadata: SyncMetadata): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(metadata, null, 2) + "\n", "utf8");
}
