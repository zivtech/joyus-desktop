import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSyncMetadata, writeSyncMetadata } from "../src/metadata";

describe("metadata", () => {
  it("returns undefined when metadata file does not exist", async () => {
    const directory = await mkdtemp(join(tmpdir(), "skill-sync-meta-"));
    const metadata = await readSyncMetadata(join(directory, "missing.json"));
    expect(metadata).toBeUndefined();
  });

  it("returns undefined for malformed json", async () => {
    const directory = await mkdtemp(join(tmpdir(), "skill-sync-meta-"));
    const path = join(directory, "meta.json");
    await writeFile(path, "{ nope", "utf8");

    const metadata = await readSyncMetadata(path);
    expect(metadata).toBeUndefined();
  });

  it("writes and reads metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "skill-sync-meta-"));
    const path = join(directory, "meta", "sync.json");

    await writeSyncMetadata(path, {
      status: "success",
      version: "v1.0.0",
      managedFiles: {
        "a/SKILL.md": "hash"
      }
    });

    const raw = await readFile(path, "utf8");
    expect(raw.endsWith("\n")).toBe(true);

    const metadata = await readSyncMetadata(path);
    expect(metadata).toEqual({
      status: "success",
      version: "v1.0.0",
      managedFiles: {
        "a/SKILL.md": "hash"
      }
    });
  });
});
