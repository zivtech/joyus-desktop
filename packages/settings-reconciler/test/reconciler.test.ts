import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as publicApi from "../src/index.js";
import type { DistributionManifest, ManifestHook, ManifestMcpServer } from "../src/manifest.js";
import {
  mergeHooks,
  mergeMcpServers,
  partitionByTarget,
  reconcile,
  removeStaleHooks,
  removeStaleMcpServers,
} from "../src/reconciler.js";
import * as registryModule from "../src/registry.js";
import * as settingsFileModule from "../src/settingsFile.js";

const FIXED_NOW = new Date("2026-04-01T12:00:00.000Z");
const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function createWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "settings-reconciler-reconcile-"));
  tempDirs.push(root);

  return {
    root,
    globalSettingsPath: join(root, "home", ".claude", "settings.json"),
    projectSettingsPath: join(root, "project", ".claude", "settings.json"),
    registryPath: join(root, "home", ".claude", ".joyus-managed.json"),
    backupDir: join(root, "backups"),
    now: () => FIXED_NOW,
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

function createHook(overrides: Partial<ManifestHook> = {}): ManifestHook {
  return {
    id: "joyus:hook",
    event: "PreToolUse",
    matcher: "joyus:hook",
    command: "echo global hook",
    ...overrides,
  };
}

function createMcp(overrides: Partial<ManifestMcpServer> = {}): ManifestMcpServer {
  return {
    id: "joyus:mcp",
    command: "node",
    ...overrides,
  };
}

function createManifest(options: {
  version?: string;
  hooks?: readonly ManifestHook[];
  mcps?: readonly ManifestMcpServer[];
} = {}): DistributionManifest {
  return {
    schema_version: "1.0",
    tenant_id: "tenant-1",
    bundles: {
      core: {
        version: options.version ?? "1.0.0",
        hooks: options.hooks ?? [],
        mcpServers: options.mcps ?? [],
      },
    },
  };
}

function createConfig(workspace: Awaited<ReturnType<typeof createWorkspace>>) {
  return {
    globalSettingsPath: workspace.globalSettingsPath,
    projectSettingsPath: workspace.projectSettingsPath,
    registryPath: workspace.registryPath,
    backupDir: workspace.backupDir,
    now: workspace.now,
  };
}

describe("index exports", () => {
  it("re-exports reconciler helpers from the package entry point", () => {
    expect(typeof publicApi.reconcile).toBe("function");
    expect(typeof publicApi.mergeHooks).toBe("function");
    expect(typeof publicApi.removeStaleHooks).toBe("function");
    expect(typeof publicApi.mergeMcpServers).toBe("function");
    expect(typeof publicApi.removeStaleMcpServers).toBe("function");
    expect(typeof publicApi.partitionByTarget).toBe("function");
  });
});

describe("pure reconciler helpers", () => {
  it("merges managed hooks without mutating current user hooks", () => {
    const userGroup = {
      matcher: "user:tool",
      hooks: [{ type: "command", command: "echo user" }],
    };
    const currentHooks = {
      PreToolUse: [
        userGroup,
        {
          matcher: "joyus:hook",
          hooks: [{ type: "command", command: "echo old", timeout: 1 }],
        },
      ],
    };

    const result = mergeHooks(currentHooks, [
      createHook({ command: "echo new" }),
      createHook({
        id: "joyus:session-start",
        event: "SessionStart",
        matcher: "joyus:session-start",
        command: "echo start",
        timeout: 9,
      }),
    ]);

    expect(result).not.toBe(currentHooks);
    expect(currentHooks.PreToolUse[0]).toBe(userGroup);
    expect(result["PreToolUse"]![0]).toBe(userGroup);
    expect(result["PreToolUse"]![1]).toEqual({
      matcher: "joyus:hook",
      hooks: [{ type: "command", command: "echo new", timeout: 5 }],
    });
    expect(result.SessionStart).toEqual([
      {
        matcher: "joyus:session-start",
        hooks: [{ type: "command", command: "echo start", timeout: 9 }],
      },
    ]);
  });

  it("removes stale managed hooks and cleans up empty hook arrays", () => {
    const userGroup = {
      matcher: "user:tool",
      hooks: [{ type: "command", command: "echo user" }],
    };
    const activeGroup = {
      matcher: "joyus:keep",
      hooks: [{ type: "command", command: "echo keep", timeout: 5 }],
    };
    const staleGroup = {
      matcher: "joyus:remove",
      hooks: [{ type: "command", command: "echo remove", timeout: 5 }],
    };

    const result = removeStaleHooks(
      {
        PreToolUse: [userGroup, activeGroup, staleGroup],
        SessionEnd: [staleGroup],
      },
      new Set(["joyus:keep"])
    );

    expect(result).toEqual({
      PreToolUse: [userGroup, activeGroup],
    });
    expect(result["PreToolUse"]![0]).toBe(userGroup);
    expect(result["PreToolUse"]![1]).toBe(activeGroup);
  });

  it("merges managed MCP servers without mutating existing user entries", () => {
    const userServer = { command: "python", args: ["user.py"] };
    const currentServers = {
      "user-mcp": userServer,
      "joyus:mcp": { command: "node", args: ["old.js"] },
    };

    const result = mergeMcpServers(currentServers, [
      createMcp({ command: "node", args: ["new.js"], env: { MODE: "managed" } }),
      createMcp({ id: "joyus:second", command: "bun" }),
    ]);

    expect(result).not.toBe(currentServers);
    expect(result["user-mcp"]).toBe(userServer);
    expect(result["joyus:mcp"]).toEqual({
      command: "node",
      args: ["new.js"],
      env: { MODE: "managed" },
    });
    expect(result["joyus:second"]).toEqual({ command: "bun" });
  });

  it("removes stale managed MCP servers without disturbing user servers", () => {
    const userServer = { command: "python", args: ["user.py"] };
    const result = removeStaleMcpServers(
      {
        "user-mcp": userServer,
        "joyus:keep": { command: "node" },
        "joyus:remove": { command: "bun" },
      },
      new Set(["joyus:keep"])
    );

    expect(result).toEqual({
      "user-mcp": userServer,
      "joyus:keep": { command: "node" },
    });
    expect(result["user-mcp"]).toBe(userServer);
  });

  it("partitions hooks and MCP servers by target and defaults to global", () => {
    const partition = partitionByTarget(
      [
        createHook(),
        createHook({
          id: "joyus:project-hook",
          matcher: "joyus:project-hook",
          target: "project",
        }),
      ],
      [
        createMcp(),
        createMcp({ id: "joyus:project-mcp", target: "project" }),
      ]
    );

    expect(partition.global.hooks).toHaveLength(1);
    expect(partition.global.mcps).toHaveLength(1);
    expect(partition.project.hooks).toHaveLength(1);
    expect(partition.project.mcps).toHaveLength(1);
  });
});

describe("reconcile", () => {
  it("adds fresh managed entries and routes global/project settings correctly", async () => {
    const workspace = await createWorkspace();
    const manifest = createManifest({
      hooks: [
        createHook(),
        createHook({
          id: "joyus:project-hook",
          event: "SessionStart",
          matcher: "joyus:project-hook",
          command: "echo project hook",
          target: "project",
        }),
      ],
      mcps: [
        createMcp(),
        createMcp({
          id: "joyus:project-mcp",
          command: "python",
          args: ["server.py"],
          target: "project",
        }),
      ],
    });

    const result = await reconcile(manifest, createConfig(workspace));

    expect(result).toMatchObject({
      status: "success",
      entriesAdded: 4,
      entriesUpdated: 0,
      entriesRemoved: 0,
      registryPath: workspace.registryPath,
    });
    expect(result.backupPath).toBeUndefined();
    expect(await readJson(workspace.globalSettingsPath)).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: "joyus:hook",
            hooks: [{ type: "command", command: "echo global hook", timeout: 5 }],
          },
        ],
      },
      mcpServers: {
        "joyus:mcp": { command: "node" },
      },
    });
    expect(await readJson(workspace.projectSettingsPath)).toEqual({
      hooks: {
        SessionStart: [
          {
            matcher: "joyus:project-hook",
            hooks: [{ type: "command", command: "echo project hook", timeout: 5 }],
          },
        ],
      },
      mcpServers: {
        "joyus:project-mcp": {
          command: "python",
          args: ["server.py"],
        },
      },
    });

    const registry = (await readJson(workspace.registryPath)) as {
      entries: Record<string, { target: string }>;
    };
    expect(Object.keys(registry.entries)).toHaveLength(4);
    expect(registry.entries["hook:SessionStart:joyus:project-hook"]!.target).toBe("project");
    expect(registry.entries["mcp:joyus:project-mcp"]!.target).toBe("project");
  });

  it("treats unchanged registry entries as no-op updates", async () => {
    const workspace = await createWorkspace();
    const installedAt = "2026-03-01T00:00:00.000Z";

    await writeJson(workspace.globalSettingsPath, {
      hooks: {
        PreToolUse: [
          {
            matcher: "joyus:hook",
            hooks: [{ type: "command", command: "echo global hook", timeout: 5 }],
          },
        ],
      },
      mcpServers: {
        "joyus:mcp": { command: "node" },
      },
    });
    await writeJson(workspace.registryPath, {
      schema_version: "1.0",
      entries: {
        "hook:PreToolUse:joyus:hook": {
          type: "hook",
          bundle: "core",
          manifest_version: "1.0.0",
          event: "PreToolUse",
          target: "global",
          installed_at: installedAt,
        },
        "mcp:joyus:mcp": {
          type: "mcp",
          bundle: "core",
          manifest_version: "1.0.0",
          target: "global",
          installed_at: installedAt,
        },
      },
      last_reconciled: installedAt,
    });

    const result = await reconcile(
      createManifest({ hooks: [createHook()], mcps: [createMcp()] }),
      createConfig(workspace)
    );

    expect(result).toMatchObject({
      status: "success",
      entriesAdded: 0,
      entriesUpdated: 0,
      entriesRemoved: 0,
    });
    expect(result.backupPath).toBeUndefined();

    const registry = (await readJson(workspace.registryPath)) as {
      entries: Record<string, { installed_at: string; manifest_version: string }>;
      last_reconciled: string;
    };
    expect(registry.entries["hook:PreToolUse:joyus:hook"]!.installed_at).toBe(installedAt);
    expect(registry.entries["mcp:joyus:mcp"]!.installed_at).toBe(installedAt);
    expect(registry.last_reconciled).toBe(FIXED_NOW.toISOString());
  });

  it("updates existing managed entries and preserves installed timestamps", async () => {
    const workspace = await createWorkspace();
    const installedAt = "2026-03-01T00:00:00.000Z";

    await writeJson(workspace.globalSettingsPath, {
      hooks: {
        PreToolUse: [
          {
            matcher: "joyus:hook",
            hooks: [{ type: "command", command: "echo old", timeout: 5 }],
          },
        ],
      },
      mcpServers: {
        "joyus:mcp": { command: "node", args: ["old.js"] },
      },
    });
    await writeJson(workspace.registryPath, {
      schema_version: "1.0",
      entries: {
        "hook:PreToolUse:joyus:hook": {
          type: "hook",
          bundle: "core",
          manifest_version: "1.0.0",
          event: "PreToolUse",
          target: "global",
          installed_at: installedAt,
        },
        "mcp:joyus:mcp": {
          type: "mcp",
          bundle: "core",
          manifest_version: "1.0.0",
          target: "global",
          installed_at: installedAt,
        },
      },
      last_reconciled: installedAt,
    });

    const result = await reconcile(
      createManifest({
        version: "2.0.0",
        hooks: [createHook({ command: "echo updated" })],
        mcps: [createMcp({ args: ["new.js"] })],
      }),
      createConfig(workspace)
    );

    expect(result).toMatchObject({
      status: "success",
      entriesAdded: 0,
      entriesUpdated: 2,
      entriesRemoved: 0,
    });
    expect(await readJson(workspace.globalSettingsPath)).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: "joyus:hook",
            hooks: [{ type: "command", command: "echo updated", timeout: 5 }],
          },
        ],
      },
      mcpServers: {
        "joyus:mcp": { command: "node", args: ["new.js"] },
      },
    });

    const registry = (await readJson(workspace.registryPath)) as {
      entries: Record<string, { installed_at: string; manifest_version: string }>;
    };
    expect(registry.entries["hook:PreToolUse:joyus:hook"]!).toMatchObject({
      installed_at: installedAt,
      manifest_version: "2.0.0",
    });
    expect(registry.entries["mcp:joyus:mcp"]!).toMatchObject({
      installed_at: installedAt,
      manifest_version: "2.0.0",
    });
  });

  it("uses default paths and timestamps when config is omitted", async () => {
    const workspace = await createWorkspace();
    const previousCwd = process.cwd();
    process.chdir(workspace.root);

    const readRegistrySpy = vi.spyOn(registryModule, "readRegistry").mockResolvedValue({
      schema_version: "1.0",
      entries: {},
      last_reconciled: FIXED_NOW.toISOString(),
    });
    const readSettingsSpy = vi.spyOn(settingsFileModule, "readSettingsFile").mockResolvedValue({});
    const writeRegistrySpy = vi.spyOn(registryModule, "writeRegistry").mockResolvedValue();

    try {
      const result = await reconcile({
        schema_version: "1.0",
        tenant_id: "tenant-1",
        bundles: {
          core: { version: "1.0.0" },
        },
      });

      expect(result).toMatchObject({
        status: "success",
        entriesAdded: 0,
        entriesUpdated: 0,
        entriesRemoved: 0,
        registryPath: join(homedir(), ".claude", ".joyus-managed.json"),
      });
      expect(readRegistrySpy).toHaveBeenCalledWith(
        join(homedir(), ".claude", ".joyus-managed.json")
      );
      expect(readSettingsSpy).toHaveBeenCalledWith(join(homedir(), ".claude", "settings.json"));
      expect(readSettingsSpy).toHaveBeenCalledWith(".claude/settings.json");
      expect(writeRegistrySpy).toHaveBeenCalledWith(
        join(homedir(), ".claude", ".joyus-managed.json"),
        {
          schema_version: "1.0",
          entries: {},
          last_reconciled: expect.any(String),
        }
      );
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("removes stale managed entries from both global and project settings", async () => {
    const workspace = await createWorkspace();
    const installedAt = "2026-03-01T00:00:00.000Z";

    await writeJson(workspace.globalSettingsPath, {
      hooks: {
        PreToolUse: [
          {
            matcher: "user:tool",
            hooks: [{ type: "command", command: "echo user" }],
          },
          {
            matcher: "joyus:hook",
            hooks: [{ type: "command", command: "echo managed", timeout: 5 }],
          },
        ],
      },
      mcpServers: {
        "user-mcp": { command: "python" },
        "joyus:mcp": { command: "node" },
      },
    });
    await writeJson(workspace.projectSettingsPath, {
      hooks: {
        SessionStart: [
          {
            matcher: "user:project",
            hooks: [{ type: "command", command: "echo project user" }],
          },
          {
            matcher: "joyus:project-hook",
            hooks: [{ type: "command", command: "echo project", timeout: 5 }],
          },
        ],
      },
      mcpServers: {
        "user-project-mcp": { command: "bun" },
        "joyus:project-mcp": { command: "python" },
      },
    });
    await writeJson(workspace.registryPath, {
      schema_version: "1.0",
      entries: {
        "hook:PreToolUse:joyus:hook": {
          type: "hook",
          bundle: "core",
          manifest_version: "1.0.0",
          event: "PreToolUse",
          target: "global",
          installed_at: installedAt,
        },
        "mcp:joyus:mcp": {
          type: "mcp",
          bundle: "core",
          manifest_version: "1.0.0",
          target: "global",
          installed_at: installedAt,
        },
        "hook:SessionStart:joyus:project-hook": {
          type: "hook",
          bundle: "core",
          manifest_version: "1.0.0",
          event: "SessionStart",
          target: "project",
          installed_at: installedAt,
        },
        "mcp:joyus:project-mcp": {
          type: "mcp",
          bundle: "core",
          manifest_version: "1.0.0",
          target: "project",
          installed_at: installedAt,
        },
      },
      last_reconciled: installedAt,
    });

    const result = await reconcile(createManifest(), createConfig(workspace));

    expect(result).toMatchObject({
      status: "success",
      entriesAdded: 0,
      entriesUpdated: 0,
      entriesRemoved: 4,
    });
    expect(await readJson(workspace.globalSettingsPath)).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: "user:tool",
            hooks: [{ type: "command", command: "echo user" }],
          },
        ],
      },
      mcpServers: {
        "user-mcp": { command: "python" },
      },
    });
    expect(await readJson(workspace.projectSettingsPath)).toEqual({
      hooks: {
        SessionStart: [
          {
            matcher: "user:project",
            hooks: [{ type: "command", command: "echo project user" }],
          },
        ],
      },
      mcpServers: {
        "user-project-mcp": { command: "bun" },
      },
    });
    expect(await readJson(workspace.registryPath)).toEqual({
      schema_version: "1.0",
      entries: {},
      last_reconciled: FIXED_NOW.toISOString(),
    });
  });

  it("deletes the hooks key when the last managed hook is removed", async () => {
    const workspace = await createWorkspace();
    const installedAt = "2026-03-01T00:00:00.000Z";

    await writeJson(workspace.globalSettingsPath, {
      hooks: {
        PreToolUse: [
          {
            matcher: "joyus:hook",
            hooks: [{ type: "command", command: "echo managed", timeout: 5 }],
          },
        ],
      },
      mcpServers: {
        "joyus:mcp": { command: "node" },
      },
    });
    await writeJson(workspace.registryPath, {
      schema_version: "1.0",
      entries: {
        "hook:PreToolUse:joyus:hook": {
          type: "hook",
          bundle: "core",
          manifest_version: "1.0.0",
          event: "PreToolUse",
          target: "global",
          installed_at: installedAt,
        },
        "mcp:joyus:mcp": {
          type: "mcp",
          bundle: "core",
          manifest_version: "1.0.0",
          target: "global",
          installed_at: installedAt,
        },
      },
      last_reconciled: installedAt,
    });

    const result = await reconcile(createManifest(), createConfig(workspace));

    expect(result).toMatchObject({
      status: "success",
      entriesAdded: 0,
      entriesUpdated: 0,
      entriesRemoved: 2,
    });
    expect(await readJson(workspace.globalSettingsPath)).toEqual({});
  });

  it("repairs a missing registry from existing settings before reconciling", async () => {
    const workspace = await createWorkspace();

    await writeJson(workspace.globalSettingsPath, {
      hooks: {
        PreToolUse: [
          {
            matcher: "joyus:hook",
            hooks: [{ type: "command", command: "echo repaired old", timeout: 5 }],
          },
        ],
      },
    });
    await writeJson(workspace.projectSettingsPath, {
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: "echo invalid" }] },
          {
            matcher: "user:project",
            hooks: [{ type: "command", command: "echo project user" }],
          },
          {
            matcher: "joyus:project-hook",
            hooks: [{ type: "command", command: "echo project managed", timeout: 5 }],
          },
        ],
      },
      mcpServers: {
        "joyus:project-mcp": { command: "python" },
        "user-project-mcp": { command: "bun" },
      },
    });

    const result = await reconcile(
      createManifest({
        hooks: [createHook({ command: "echo repaired new" })],
      }),
      createConfig(workspace)
    );

    expect(result).toMatchObject({
      status: "success",
      entriesAdded: 0,
      entriesUpdated: 1,
      entriesRemoved: 2,
    });
    expect(await readJson(workspace.globalSettingsPath)).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: "joyus:hook",
            hooks: [{ type: "command", command: "echo repaired new", timeout: 5 }],
          },
        ],
      },
    });
    expect(await readJson(workspace.projectSettingsPath)).toEqual({
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: "echo invalid" }] },
          {
            matcher: "user:project",
            hooks: [{ type: "command", command: "echo project user" }],
          },
        ],
      },
      mcpServers: {
        "user-project-mcp": { command: "bun" },
      },
    });

    const registry = (await readJson(workspace.registryPath)) as {
      entries: Record<string, { bundle: string; target: string }>;
    };
    expect(registry.entries).toEqual({
      "hook:PreToolUse:joyus:hook": {
        type: "hook",
        bundle: "core",
        manifest_version: "1.0.0",
        event: "PreToolUse",
        target: "global",
        installed_at: FIXED_NOW.toISOString(),
      },
    });
  });

  it("rolls back global and project settings if registry persistence fails", async () => {
    const workspace = await createWorkspace();
    const originalGlobal = {
      hooks: {
        PreToolUse: [
          {
            matcher: "joyus:hook",
            hooks: [{ type: "command", command: "echo original", timeout: 5 }],
          },
        ],
      },
    };
    const originalProject = {
      mcpServers: {
        "joyus:project-mcp": { command: "python" },
      },
    };

    await writeJson(workspace.globalSettingsPath, originalGlobal);
    await writeJson(workspace.projectSettingsPath, originalProject);

    vi.spyOn(registryModule, "writeRegistry").mockRejectedValueOnce(
      new Error("registry write failed")
    );

    const result = await reconcile(
      createManifest({
        hooks: [createHook({ command: "echo updated" })],
        mcps: [createMcp({ id: "joyus:project-mcp", command: "bun", target: "project" })],
      }),
      createConfig(workspace)
    );

    expect(result).toMatchObject({
      status: "rolled_back",
      error: "registry write failed",
    });
    expect(await readJson(workspace.globalSettingsPath)).toEqual(originalGlobal);
    expect(await readJson(workspace.projectSettingsPath)).toEqual(originalProject);
    await expect(readFile(workspace.registryPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("still returns rolled_back when rollback restoration itself fails", async () => {
    const workspace = await createWorkspace();

    await writeJson(workspace.globalSettingsPath, {
      hooks: {
        PreToolUse: [
          {
            matcher: "joyus:hook",
            hooks: [{ type: "command", command: "echo original", timeout: 5 }],
          },
        ],
      },
    });
    await writeJson(workspace.projectSettingsPath, {
      mcpServers: {
        "joyus:project-mcp": { command: "python" },
      },
    });

    vi.spyOn(registryModule, "writeRegistry").mockRejectedValueOnce(
      new Error("registry write failed")
    );
    vi.spyOn(settingsFileModule, "rollbackSettings").mockRejectedValue(
      new Error("rollback failed")
    );

    const result = await reconcile(
      createManifest({
        hooks: [createHook({ command: "echo updated" })],
        mcps: [createMcp({ id: "joyus:project-mcp", command: "bun", target: "project" })],
      }),
      createConfig(workspace)
    );

    expect(result).toMatchObject({
      status: "rolled_back",
      error: "registry write failed",
    });
  });

  it("removes newly created settings files when rollback happens without backups", async () => {
    const workspace = await createWorkspace();

    vi.spyOn(registryModule, "writeRegistry").mockRejectedValueOnce("registry write failed");

    const result = await reconcile(
      createManifest({
        hooks: [createHook()],
      }),
      createConfig(workspace)
    );

    expect(result).toMatchObject({
      status: "rolled_back",
      error: "registry write failed",
    });
    await expect(readFile(workspace.globalSettingsPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(workspace.projectSettingsPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("skips unsupported schema versions without modifying settings", async () => {
    const workspace = await createWorkspace();
    await writeJson(workspace.globalSettingsPath, { existing: true });

    const result = await reconcile(
      {
        schema_version: "9.9",
        tenant_id: "tenant-1",
        bundles: {},
      },
      createConfig(workspace)
    );

    expect(result).toEqual({
      status: "skipped",
      entriesAdded: 0,
      entriesUpdated: 0,
      entriesRemoved: 0,
      registryPath: workspace.registryPath,
    });
    expect(await readJson(workspace.globalSettingsPath)).toEqual({ existing: true });
    await expect(readFile(workspace.registryPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
