import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSettingsBackup,
  readSettingsFile,
  rollbackSettings,
  writeSettingsFile,
} from "../src/index";
import { rm } from "node:fs/promises";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "settings-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("readSettingsFile", () => {
  it("returns parsed object for valid JSON file", async () => {
    const path = join(tmpDir, "settings.json");
    await writeFile(path, JSON.stringify({ foo: "bar", nested: { x: 1 } }, null, 2) + "\n");
    const result = await readSettingsFile(path);
    expect(result).toEqual({ foo: "bar", nested: { x: 1 } });
  });

  it("returns {} for missing file", async () => {
    const result = await readSettingsFile(join(tmpDir, "nonexistent.json"));
    expect(result).toEqual({});
  });

  it("returns {} for empty file", async () => {
    const path = join(tmpDir, "empty.json");
    await writeFile(path, "");
    const result = await readSettingsFile(path);
    expect(result).toEqual({});
  });

  it("returns {} for whitespace-only file", async () => {
    const path = join(tmpDir, "whitespace.json");
    await writeFile(path, "   \n  ");
    const result = await readSettingsFile(path);
    expect(result).toEqual({});
  });

  it("returns {} for corrupted JSON", async () => {
    const path = join(tmpDir, "corrupt.json");
    await writeFile(path, "{ invalid json {{");
    const result = await readSettingsFile(path);
    expect(result).toEqual({});
  });

  it("returns {} for JSON array (not an object)", async () => {
    const path = join(tmpDir, "array.json");
    await writeFile(path, JSON.stringify([1, 2, 3]));
    const result = await readSettingsFile(path);
    expect(result).toEqual({});
  });

  it("returns full nested structure", async () => {
    const settings = { a: { b: { c: true } }, d: [1, 2] };
    const path = join(tmpDir, "nested.json");
    await writeFile(path, JSON.stringify(settings));
    const result = await readSettingsFile(path);
    expect(result).toEqual(settings);
  });
});

describe("writeSettingsFile", () => {
  it("writes pretty-printed JSON with trailing newline", async () => {
    const path = join(tmpDir, "settings.json");
    await writeSettingsFile(path, { hello: "world" });
    const raw = await readFile(path, "utf8");
    expect(raw).toBe(JSON.stringify({ hello: "world" }, null, 2) + "\n");
  });

  it("creates parent directories if missing", async () => {
    const path = join(tmpDir, "deep", "nested", "settings.json");
    await writeSettingsFile(path, { x: 1 });
    const raw = await readFile(path, "utf8");
    expect(JSON.parse(raw)).toEqual({ x: 1 });
  });

  it("does not leave tmp file after success", async () => {
    const path = join(tmpDir, "settings.json");
    await writeSettingsFile(path, { a: 1 });
    let tmpExists = false;
    try {
      await readFile(`${path}.tmp`);
      tmpExists = true;
    } catch {
      // expected
    }
    expect(tmpExists).toBe(false);
  });

  it("overwrites existing file", async () => {
    const path = join(tmpDir, "settings.json");
    await writeSettingsFile(path, { v: 1 });
    await writeSettingsFile(path, { v: 2 });
    const raw = await readFile(path, "utf8");
    expect(JSON.parse(raw)).toEqual({ v: 2 });
  });
});

describe("createSettingsBackup", () => {
  it("throws non-ENOENT errors from readFile", async () => {
    // Pass a directory path — readFile on a directory throws EISDIR, not ENOENT
    const dirPath = tmpDir; // tmpDir is a directory
    const backupDir = join(tmpDir, "backups");
    await expect(createSettingsBackup(dirPath, backupDir, 5)).rejects.toThrow();
  });

  it("creates a backup file with correct content", async () => {
    const settingsPath = join(tmpDir, "settings.json");
    const backupDir = join(tmpDir, "backups");
    await writeFile(settingsPath, JSON.stringify({ key: "value" }, null, 2) + "\n");

    const now = () => new Date("2024-01-15T10:30:00.000Z");
    const result = await createSettingsBackup(settingsPath, backupDir, 5, now);

    expect(result).toBeDefined();
    expect(result).toContain("2024-01-15T10-30-00-000Z-settings.json");
    const content = await readFile(result!, "utf8");
    expect(JSON.parse(content)).toEqual({ key: "value" });
  });

  it("returns undefined when source file is missing", async () => {
    const settingsPath = join(tmpDir, "nonexistent.json");
    const backupDir = join(tmpDir, "backups");
    const result = await createSettingsBackup(settingsPath, backupDir, 5);
    expect(result).toBeUndefined();
  });

  it("creates backup directory if it does not exist", async () => {
    const settingsPath = join(tmpDir, "settings.json");
    const backupDir = join(tmpDir, "new-backup-dir");
    await writeFile(settingsPath, "{}");

    const result = await createSettingsBackup(settingsPath, backupDir, 5);
    expect(result).toBeDefined();
    const content = await readFile(result!, "utf8");
    expect(content).toBe("{}");
  });

  it("rotates old backups beyond maxBackups", async () => {
    const settingsPath = join(tmpDir, "settings.json");
    const backupDir = join(tmpDir, "backups");
    await mkdir(backupDir, { recursive: true });
    await writeFile(settingsPath, "{}");

    // Pre-create 4 old backup files (older timestamps)
    const oldTimestamps = [
      "2024-01-01T00-00-00-000Z",
      "2024-01-02T00-00-00-000Z",
      "2024-01-03T00-00-00-000Z",
      "2024-01-04T00-00-00-000Z",
    ];
    for (const ts of oldTimestamps) {
      await writeFile(join(backupDir, `${ts}-settings.json`), "{}");
    }

    // Create 2 more backups with maxBackups=4 → should prune oldest 2
    const now1 = () => new Date("2024-01-05T00:00:00.000Z");
    await createSettingsBackup(settingsPath, backupDir, 4, now1);

    const now2 = () => new Date("2024-01-06T00:00:00.000Z");
    await createSettingsBackup(settingsPath, backupDir, 4, now2);

    const entries = await readFile(join(backupDir, "2024-01-01T00-00-00-000Z-settings.json")).then(() => true).catch(() => false);
    const entries2 = await readFile(join(backupDir, "2024-01-02T00-00-00-000Z-settings.json")).then(() => true).catch(() => false);
    expect(entries).toBe(false);
    expect(entries2).toBe(false);

    // The 4 newest should still exist
    const kept3 = await readFile(join(backupDir, "2024-01-03T00-00-00-000Z-settings.json")).then(() => true).catch(() => false);
    const kept4 = await readFile(join(backupDir, "2024-01-04T00-00-00-000Z-settings.json")).then(() => true).catch(() => false);
    expect(kept3).toBe(true);
    expect(kept4).toBe(true);
  });
});

describe("rollbackSettings", () => {
  it("restores settings from backup", async () => {
    const settingsPath = join(tmpDir, "settings.json");
    const backupPath = join(tmpDir, "backup-settings.json");
    await writeFile(backupPath, JSON.stringify({ restored: true }, null, 2) + "\n");

    await rollbackSettings(settingsPath, backupPath);

    const content = await readFile(settingsPath, "utf8");
    expect(JSON.parse(content)).toEqual({ restored: true });
  });

  it("throws if backup file is missing", async () => {
    const settingsPath = join(tmpDir, "settings.json");
    const backupPath = join(tmpDir, "nonexistent-backup.json");
    await expect(rollbackSettings(settingsPath, backupPath)).rejects.toThrow(
      "Backup file not found"
    );
  });

  it("throws non-ENOENT errors from readFile on backup", async () => {
    // Pass a directory path as backup — readFile on a directory throws EISDIR
    const settingsPath = join(tmpDir, "settings.json");
    await expect(rollbackSettings(settingsPath, tmpDir)).rejects.toThrow();
  });

  it("uses atomic write (no tmp file after success)", async () => {
    const settingsPath = join(tmpDir, "settings.json");
    const backupPath = join(tmpDir, "backup.json");
    await writeFile(backupPath, "{}");

    await rollbackSettings(settingsPath, backupPath);

    let tmpExists = false;
    try {
      await readFile(`${settingsPath}.tmp`);
      tmpExists = true;
    } catch {
      // expected
    }
    expect(tmpExists).toBe(false);
    const content = await readFile(settingsPath, "utf8");
    expect(content).toBe("{}");
  });

  it("overwrites existing settings file", async () => {
    const settingsPath = join(tmpDir, "settings.json");
    const backupPath = join(tmpDir, "backup.json");
    await writeFile(settingsPath, JSON.stringify({ old: true }));
    await writeFile(backupPath, JSON.stringify({ new: true }));

    await rollbackSettings(settingsPath, backupPath);

    const content = await readFile(settingsPath, "utf8");
    expect(JSON.parse(content)).toEqual({ new: true });
  });
});
