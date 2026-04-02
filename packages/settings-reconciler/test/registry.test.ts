import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readRegistry,
  repairRegistry,
  writeRegistry,
  type ManagedRegistry,
} from "../src/index";

function tmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "settings-reconciler-"));
}

const VALID_REGISTRY: ManagedRegistry = {
  schema_version: "1.0",
  entries: {
    "hook:PreToolUse:joyus:test": {
      type: "hook",
      bundle: "test-bundle",
      manifest_version: "1.0.0",
      event: "PreToolUse",
      target: "global",
      installed_at: "2026-01-01T00:00:00.000Z",
    },
  },
  last_reconciled: "2026-01-01T00:00:00.000Z",
};

describe("readRegistry", () => {
  it("returns parsed registry for a valid file", async () => {
    const dir = await tmpDir();
    const path = join(dir, ".joyus-managed.json");
    await writeFile(path, JSON.stringify(VALID_REGISTRY, null, 2) + "\n", "utf8");

    const result = await readRegistry(path);
    expect(result).toEqual(VALID_REGISTRY);
  });

  it("returns undefined for a missing file (ENOENT)", async () => {
    const dir = await tmpDir();
    const result = await readRegistry(join(dir, "nonexistent.json"));
    expect(result).toBeUndefined();
  });

  it("returns undefined for corrupted JSON (no throw)", async () => {
    const dir = await tmpDir();
    const path = join(dir, "corrupt.json");
    await writeFile(path, "{ not valid json", "utf8");

    const result = await readRegistry(path);
    expect(result).toBeUndefined();
  });

  it("returns undefined for an empty file", async () => {
    const dir = await tmpDir();
    const path = join(dir, "empty.json");
    await writeFile(path, "", "utf8");

    const result = await readRegistry(path);
    expect(result).toBeUndefined();
  });
});

describe("writeRegistry", () => {
  it("writes valid JSON with trailing newline", async () => {
    const dir = await tmpDir();
    const path = join(dir, ".joyus-managed.json");

    await writeRegistry(path, VALID_REGISTRY);

    const raw = await readFile(path, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(JSON.parse(raw)).toEqual(VALID_REGISTRY);
  });

  it("creates parent directories if missing", async () => {
    const dir = await tmpDir();
    const path = join(dir, "nested", "deep", ".joyus-managed.json");

    await writeRegistry(path, VALID_REGISTRY);

    const raw = await readFile(path, "utf8");
    expect(JSON.parse(raw)).toEqual(VALID_REGISTRY);
  });

  it("does not leave a temp file behind (atomic write)", async () => {
    const dir = await tmpDir();
    const path = join(dir, ".joyus-managed.json");

    await writeRegistry(path, VALID_REGISTRY);

    const tmpPath = `${path}.tmp`;
    await expect(stat(tmpPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("repairRegistry", () => {
  it("finds joyus: hooks across multiple event types", async () => {
    const dir = await tmpDir();
    const settingsPath = join(dir, "settings.json");
    const fixedDate = new Date("2026-03-01T00:00:00.000Z");

    const settings = {
      hooks: {
        PreToolUse: [{ matcher: "joyus:test-bundle", hooks: [{ command: "echo pre" }] }],
        PostToolUse: [{ matcher: "joyus:another", hooks: [{ command: "echo post" }] }],
        SessionStart: [{ matcher: "joyus:startup", hooks: [{ command: "echo start" }] }],
      },
    };
    await writeFile(settingsPath, JSON.stringify(settings), "utf8");

    const registry = await repairRegistry(settingsPath, () => fixedDate);

    expect(registry.schema_version).toBe("1.0");
    expect(registry.last_reconciled).toBe(fixedDate.toISOString());
    expect(Object.keys(registry.entries)).toHaveLength(3);
    expect(registry.entries["hook:PreToolUse:joyus:test-bundle"]).toMatchObject({
      type: "hook",
      event: "PreToolUse",
      bundle: "unknown",
      manifest_version: "unknown",
      target: "global",
    });
    expect(registry.entries["hook:PostToolUse:joyus:another"]).toMatchObject({
      type: "hook",
      event: "PostToolUse",
    });
    expect(registry.entries["hook:SessionStart:joyus:startup"]).toMatchObject({
      type: "hook",
      event: "SessionStart",
    });
  });

  it("finds joyus: MCP server keys", async () => {
    const dir = await tmpDir();
    const settingsPath = join(dir, "settings.json");
    const fixedDate = new Date("2026-03-01T00:00:00.000Z");

    const settings = {
      mcpServers: {
        "joyus:my-mcp": { command: "node", args: ["server.js"] },
        "joyus:another-mcp": { command: "python", args: ["server.py"] },
        "other-tool": { command: "other" },
      },
    };
    await writeFile(settingsPath, JSON.stringify(settings), "utf8");

    const registry = await repairRegistry(settingsPath, () => fixedDate);

    expect(Object.keys(registry.entries)).toHaveLength(2);
    expect(registry.entries["mcp:joyus:my-mcp"]).toMatchObject({
      type: "mcp",
      bundle: "unknown",
      manifest_version: "unknown",
      target: "global",
    });
    expect(registry.entries["mcp:joyus:another-mcp"]).toMatchObject({ type: "mcp" });
  });

  it("excludes non-joyus entries from result (mixed settings)", async () => {
    const dir = await tmpDir();
    const settingsPath = join(dir, "settings.json");
    const fixedDate = new Date("2026-03-01T00:00:00.000Z");

    const settings = {
      hooks: {
        PreToolUse: [
          { matcher: "joyus:managed", hooks: [{ command: "echo managed" }] },
          { matcher: "MyTool", hooks: [{ command: "echo user" }] },
        ],
      },
      mcpServers: {
        "joyus:managed-mcp": { command: "node" },
        "user-mcp": { command: "python" },
      },
    };
    await writeFile(settingsPath, JSON.stringify(settings), "utf8");

    const registry = await repairRegistry(settingsPath, () => fixedDate);

    expect(Object.keys(registry.entries)).toHaveLength(2);
    expect(registry.entries["hook:PreToolUse:joyus:managed"]).toBeDefined();
    expect(registry.entries["mcp:joyus:managed-mcp"]).toBeDefined();
  });

  it("returns empty registry for missing settings file", async () => {
    const dir = await tmpDir();
    const fixedDate = new Date("2026-03-01T00:00:00.000Z");

    const registry = await repairRegistry(join(dir, "nonexistent.json"), () => fixedDate);

    expect(registry.schema_version).toBe("1.0");
    expect(Object.keys(registry.entries)).toHaveLength(0);
    expect(registry.last_reconciled).toBe(fixedDate.toISOString());
  });

  it("returns empty registry for corrupted settings file", async () => {
    const dir = await tmpDir();
    const settingsPath = join(dir, "settings.json");
    const fixedDate = new Date("2026-03-01T00:00:00.000Z");
    await writeFile(settingsPath, "{ bad json", "utf8");

    const registry = await repairRegistry(settingsPath, () => fixedDate);

    expect(registry.schema_version).toBe("1.0");
    expect(Object.keys(registry.entries)).toHaveLength(0);
  });

  it("returns empty registry when settings has no joyus: entries", async () => {
    const dir = await tmpDir();
    const settingsPath = join(dir, "settings.json");
    const fixedDate = new Date("2026-03-01T00:00:00.000Z");

    const settings = {
      hooks: {
        PreToolUse: [{ matcher: "SomeTool", hooks: [{ command: "echo hi" }] }],
      },
      mcpServers: {
        "user-mcp": { command: "node" },
      },
    };
    await writeFile(settingsPath, JSON.stringify(settings), "utf8");

    const registry = await repairRegistry(settingsPath, () => fixedDate);

    expect(Object.keys(registry.entries)).toHaveLength(0);
  });

  it("uses current time by default (no now parameter)", async () => {
    const dir = await tmpDir();
    const settingsPath = join(dir, "settings.json");
    await writeFile(settingsPath, JSON.stringify({}), "utf8");

    const before = Date.now();
    const registry = await repairRegistry(settingsPath);
    const after = Date.now();

    const reconciledMs = new Date(registry.last_reconciled).getTime();
    expect(reconciledMs).toBeGreaterThanOrEqual(before);
    expect(reconciledMs).toBeLessThanOrEqual(after);
  });
});
