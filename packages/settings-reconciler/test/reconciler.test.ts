import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
      [createHook({ id: "joyus:keep", matcher: "joyus:keep", command: "echo keep" })]
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

  it("adds a managed hook to the user's group without removing the user's hooks", () => {
    const userHook = { type: "command", command: "echo user-bash" };
    const currentHooks = { PreToolUse: [{ matcher: "Bash", hooks: [userHook] }] };
    const managed = createHook({ id: "joyus:audit", matcher: "Bash", command: "echo audit" });
    const owned = [{ event: "PreToolUse", matcher: "Bash", command: "echo audit" }];

    const once = mergeHooks(currentHooks, [managed]);

    expect(once).toEqual({
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [userHook, { type: "command", command: "echo audit", timeout: 5 }],
        },
      ],
    });
    // The input is not mutated.
    expect(currentHooks.PreToolUse[0]!.hooks).toEqual([userHook]);
    // Merging again changes nothing, with or without the registry's record.
    expect(mergeHooks(once, [managed], owned)).toEqual(once);
    expect(mergeHooks(once, [managed])).toEqual(once);
  });

  it("leaves an identical command the user already had exactly as it is", () => {
    const userEntry = { type: "command", command: "echo audit", timeout: 30, note: "mine" };
    const userGroup = { matcher: "Bash", hooks: [userEntry] };
    const managed = createHook({
      id: "joyus:audit",
      matcher: "Bash",
      command: "echo audit",
      timeout: 9,
    });

    const result = mergeHooks({ PreToolUse: [userGroup] }, [managed]);

    // Same group object, same entry object: nothing was rewritten.
    expect(result["PreToolUse"]).toHaveLength(1);
    expect(result["PreToolUse"]![0]).toBe(userGroup);
    expect(userGroup.hooks).toEqual([
      { type: "command", command: "echo audit", timeout: 30, note: "mine" },
    ]);
  });

  it("refreshes an owned entry in place when the manifest changes its timeout", () => {
    const before = { type: "command", command: "echo user-before" };
    const after = { type: "command", command: "echo user-after" };
    const currentHooks = {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [before, { type: "command", command: "echo audit", timeout: 5 }, after],
        },
      ],
    };
    const managed = createHook({
      id: "joyus:audit",
      matcher: "Bash",
      command: "echo audit",
      timeout: 20,
    });
    const owned = [{ event: "PreToolUse", matcher: "Bash", command: "echo audit" }];

    expect(mergeHooks(currentHooks, [managed], owned)).toEqual({
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [before, { type: "command", command: "echo audit", timeout: 20 }, after],
        },
      ],
    });
    // Without the registry's record the same entry counts as the user's.
    expect(mergeHooks(currentHooks, [managed])).toEqual(currentHooks);
  });

  it("writes one entry when two manifest hooks share event, matcher and command", () => {
    const first = createHook({ id: "joyus:a", matcher: "Bash", command: "echo same" });
    const second = createHook({ id: "joyus:b", matcher: "Bash", command: "echo same", timeout: 7 });

    expect(mergeHooks({}, [first, second])).toEqual({
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: "echo same", timeout: 7 }] },
      ],
    });
  });

  it("removes only the owned command from a shared group", () => {
    const userHook = { type: "command", command: "echo user-bash" };
    const managed = createHook({ id: "joyus:audit", matcher: "Bash", command: "echo audit" });
    const installed = mergeHooks({ PreToolUse: [{ matcher: "Bash", hooks: [userHook] }] }, [managed]);
    const owned = [{ event: "PreToolUse", matcher: "Bash", command: "echo audit" }];

    expect(removeStaleHooks(installed, [], owned)).toEqual({
      PreToolUse: [{ matcher: "Bash", hooks: [userHook] }],
    });

    // Still in the manifest: the group object is kept as it is.
    const kept = removeStaleHooks(installed, [managed], owned);
    expect(kept["PreToolUse"]![0]).toBe(installed["PreToolUse"]![0]);
  });

  it("replaces the owned command when the manifest changes it", () => {
    const userHook = { type: "command", command: "echo user-bash" };
    const before = createHook({ id: "joyus:audit", matcher: "Bash", command: "echo audit" });
    const after = createHook({ id: "joyus:audit", matcher: "Bash", command: "echo audit v2" });
    const installed = mergeHooks({ PreToolUse: [{ matcher: "Bash", hooks: [userHook] }] }, [before]);
    const owned = [{ event: "PreToolUse", matcher: "Bash", command: "echo audit" }];

    const result = removeStaleHooks(mergeHooks(installed, [after], owned), [after], owned);

    expect(result).toEqual({
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [userHook, { type: "command", command: "echo audit v2", timeout: 5 }],
        },
      ],
    });
  });

  it("drops a group and its event when every hook in it was owned and is revoked", () => {
    const managed = createHook({ id: "joyus:audit", matcher: "Bash", command: "echo audit" });
    const installed = mergeHooks({}, [managed]);
    const owned = [{ event: "PreToolUse", matcher: "Bash", command: "echo audit" }];

    expect(removeStaleHooks(installed, [], owned)).toEqual({});
  });

  it("never removes a command that is not recorded as owned", () => {
    const managed = createHook({ id: "joyus:audit", matcher: "Bash", command: "echo audit" });
    const installed = mergeHooks({}, [managed]);

    expect(removeStaleHooks(installed, [])).toEqual(installed);
  });

  it("removes one entry per owned command, even when the user added a duplicate", () => {
    const ours = { type: "command", command: "echo audit", timeout: 5 };
    const userCopy = { type: "command", command: "echo audit", timeout: 30 };
    const owned = [{ event: "PreToolUse", matcher: "Bash", command: "echo audit" }];

    expect(
      removeStaleHooks({ PreToolUse: [{ matcher: "Bash", hooks: [ours, userCopy] }] }, [], owned)
    ).toEqual({ PreToolUse: [{ matcher: "Bash", hooks: [userCopy] }] });
  });

  it("leaves malformed groups and entries untouched", () => {
    const odd = {
      PreToolUse: [
        "text",
        { matcher: 5 },
        { matcher: "Bash", hooks: "not-an-array" },
        { matcher: "Edit", hooks: ["text-entry", { command: 7 }] },
      ],
    } as unknown as Record<string, unknown[]>;
    const owned = [
      { event: "PreToolUse", matcher: "Bash", command: "x" },
      { event: "PreToolUse", matcher: "Edit", command: "y" },
    ];

    expect(removeStaleHooks(odd, [], owned)).toEqual(odd);

    // A group whose hook list cannot be read is not joined: a new group is added.
    const merged = mergeHooks(odd, [
      createHook({ id: "joyus:a", matcher: "Bash", command: "echo a" }),
      createHook({ id: "joyus:b", matcher: "Edit", command: "echo b" }),
    ]);
    expect(merged["PreToolUse"]).toEqual([
      "text",
      { matcher: 5 },
      { matcher: "Bash", hooks: "not-an-array" },
      {
        matcher: "Edit",
        hooks: ["text-entry", { command: 7 }, { type: "command", command: "echo b", timeout: 5 }],
      },
      { matcher: "Bash", hooks: [{ type: "command", command: "echo a", timeout: 5 }] },
    ]);
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
          matcher: "joyus:hook",
          command: "echo global hook",
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
    // The write path reads through the strict reader. Mock it, or this test
    // reads (and could rewrite) the developer's real ~/.claude/settings.json.
    const readSettingsSpy = vi
      .spyOn(settingsFileModule, "readSettingsFileStrict")
      .mockResolvedValue({});
    // Registry repair uses the lenient reader. It does not run here, because
    // readRegistry is mocked; keep it mocked so it can never reach a real file.
    const lenientReadSpy = vi.spyOn(settingsFileModule, "readSettingsFile").mockResolvedValue({});
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
      expect(lenientReadSpy).not.toHaveBeenCalled();
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
        matcher: "joyus:hook",
        command: "echo repaired new",
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

  it("does not write a global settings file that is not valid JSON", async () => {
    const workspace = await createWorkspace();
    const truncated = '{ "permissions": { "deny": ["Bash(rm:*)"] }, ';
    await mkdir(dirname(workspace.globalSettingsPath), { recursive: true });
    await writeFile(workspace.globalSettingsPath, truncated, "utf8");

    const result = await reconcile(
      createManifest({ hooks: [createHook()] }),
      createConfig(workspace)
    );

    expect(result.status).toBe("rolled_back");
    expect(result.error).toContain("not valid JSON");
    expect(result.error).toContain(workspace.globalSettingsPath);
    expect(await readFile(workspace.globalSettingsPath, "utf8")).toBe(truncated);
    await expect(readdir(join(workspace.backupDir, "global"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(workspace.registryPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("restores global settings when the project settings file is not valid JSON", async () => {
    const workspace = await createWorkspace();
    const originalGlobal = { model: "example-model", hooks: {} };
    await writeJson(workspace.globalSettingsPath, originalGlobal);
    await mkdir(dirname(workspace.projectSettingsPath), { recursive: true });
    await writeFile(workspace.projectSettingsPath, "{ broken", "utf8");

    const result = await reconcile(
      createManifest({
        hooks: [createHook()],
        mcps: [createMcp({ id: "joyus:project-mcp", target: "project" })],
      }),
      createConfig(workspace)
    );

    expect(result.status).toBe("rolled_back");
    expect(result.error).toContain(workspace.projectSettingsPath);
    expect(await readJson(workspace.globalSettingsPath)).toEqual(originalGlobal);
    expect(await readFile(workspace.projectSettingsPath, "utf8")).toBe("{ broken");
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

  it("installs a tool-scoped hook beside the user's hook and removes only it on revocation", async () => {
    const workspace = await createWorkspace();
    const userSettings = {
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "echo user-bash" }] },
        ],
      },
    };
    await writeJson(workspace.globalSettingsPath, userSettings);
    const originalText = await readFile(workspace.globalSettingsPath, "utf8");

    const managed = createHook({ id: "joyus:audit", matcher: "Bash", command: "echo audit" });

    const installed = await reconcile(createManifest({ hooks: [managed] }), createConfig(workspace));
    expect(installed).toMatchObject({ status: "success", entriesAdded: 1 });
    expect(await readJson(workspace.globalSettingsPath)).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              { type: "command", command: "echo user-bash" },
              { type: "command", command: "echo audit", timeout: 5 },
            ],
          },
        ],
      },
    });

    const registry = (await readJson(workspace.registryPath)) as {
      entries: Record<string, unknown>;
    };
    expect(registry.entries["hook:PreToolUse:joyus:audit"]).toEqual({
      type: "hook",
      bundle: "core",
      manifest_version: "1.0.0",
      event: "PreToolUse",
      matcher: "Bash",
      command: "echo audit",
      target: "global",
      installed_at: FIXED_NOW.toISOString(),
    });

    // A second run with the same manifest changes nothing and makes no backup.
    const again = await reconcile(createManifest({ hooks: [managed] }), createConfig(workspace));
    expect(again).toMatchObject({ status: "success", entriesAdded: 0, entriesUpdated: 0 });
    expect(again.backupPath).toBeUndefined();

    // The manifest drops the hook: only the managed command goes away.
    const revoked = await reconcile(createManifest({ hooks: [] }), createConfig(workspace));
    expect(revoked).toMatchObject({ status: "success", entriesRemoved: 1 });
    expect(await readFile(workspace.globalSettingsPath, "utf8")).toBe(originalText);
  });

  it("never rewrites or removes an identical command the user already had", async () => {
    const workspace = await createWorkspace();
    // Unusual formatting on purpose: any rewrite of the file would change it.
    const originalText = JSON.stringify(
      {
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [{ type: "command", command: "echo audit", timeout: 30, note: "mine" }],
            },
          ],
        },
      },
      null,
      4
    );
    await mkdir(dirname(workspace.globalSettingsPath), { recursive: true });
    await writeFile(workspace.globalSettingsPath, originalText, "utf8");

    const managed = createHook({ id: "joyus:audit", matcher: "Bash", command: "echo audit" });

    const installed = await reconcile(createManifest({ hooks: [managed] }), createConfig(workspace));
    expect(installed).toMatchObject({ status: "success", entriesAdded: 1 });
    expect(installed.backupPath).toBeUndefined();
    expect(await readFile(workspace.globalSettingsPath, "utf8")).toBe(originalText);

    // The registry lists the hook but records no command: it owns nothing here.
    const registry = (await readJson(workspace.registryPath)) as {
      entries: Record<string, unknown>;
    };
    expect(registry.entries["hook:PreToolUse:joyus:audit"]).toEqual({
      type: "hook",
      bundle: "core",
      manifest_version: "1.0.0",
      event: "PreToolUse",
      matcher: "Bash",
      target: "global",
      installed_at: FIXED_NOW.toISOString(),
    });

    // Still the user's on a later run, and still there after revocation.
    const again = await reconcile(
      createManifest({ hooks: [{ ...managed, timeout: 9 }] }),
      createConfig(workspace)
    );
    expect(again).toMatchObject({ status: "success", entriesAdded: 0, entriesUpdated: 0 });
    expect(await readFile(workspace.globalSettingsPath, "utf8")).toBe(originalText);

    const revoked = await reconcile(createManifest({ hooks: [] }), createConfig(workspace));
    expect(revoked).toMatchObject({ status: "success", entriesRemoved: 1 });
    expect(await readFile(workspace.globalSettingsPath, "utf8")).toBe(originalText);
  });

  it("keeps the user's identical command intact while other managed hooks come and go", async () => {
    const workspace = await createWorkspace();
    const userSettings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "echo audit", timeout: 30, note: "mine" }],
          },
        ],
      },
    };
    await writeJson(workspace.globalSettingsPath, userSettings);

    const same = createHook({ id: "joyus:audit", matcher: "Bash", command: "echo audit" });
    const other = createHook({ id: "joyus:lint", matcher: "Bash", command: "echo lint" });

    await reconcile(createManifest({ hooks: [same, other] }), createConfig(workspace));
    expect(await readJson(workspace.globalSettingsPath)).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              { type: "command", command: "echo audit", timeout: 30, note: "mine" },
              { type: "command", command: "echo lint", timeout: 5 },
            ],
          },
        ],
      },
    });

    const revoked = await reconcile(createManifest({ hooks: [] }), createConfig(workspace));
    expect(revoked).toMatchObject({ status: "success", entriesRemoved: 2 });
    expect(await readJson(workspace.globalSettingsPath)).toEqual(userSettings);
  });

  it("takes ownership once the user removes their own identical command", async () => {
    const workspace = await createWorkspace();
    await writeJson(workspace.globalSettingsPath, {
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo audit" }] }],
      },
    });
    const manifest = createManifest({
      hooks: [createHook({ id: "joyus:audit", matcher: "Bash", command: "echo audit" })],
    });

    await reconcile(manifest, createConfig(workspace));
    // The user deletes their entry.
    await writeJson(workspace.globalSettingsPath, {});

    const result = await reconcile(manifest, createConfig(workspace));
    expect(result).toMatchObject({ status: "success", entriesAdded: 0, entriesUpdated: 1 });
    expect(await readJson(workspace.globalSettingsPath)).toEqual({
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "echo audit", timeout: 5 }] },
        ],
      },
    });

    const revoked = await reconcile(createManifest({ hooks: [] }), createConfig(workspace));
    expect(revoked).toMatchObject({ status: "success", entriesRemoved: 1 });
    expect(await readJson(workspace.globalSettingsPath)).toEqual({});
  });

  it("refreshes an owned hook in place and moves it when its target changes", async () => {
    const workspace = await createWorkspace();
    const userHook = { type: "command", command: "echo user-bash" };
    await writeJson(workspace.globalSettingsPath, {
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [userHook] }] },
    });
    const managed = createHook({ id: "joyus:audit", matcher: "Bash", command: "echo audit" });

    await reconcile(createManifest({ hooks: [managed] }), createConfig(workspace));

    // Same command, new timeout: the one entry is updated where it is.
    await reconcile(
      createManifest({ hooks: [{ ...managed, timeout: 20 }] }),
      createConfig(workspace)
    );
    expect(await readJson(workspace.globalSettingsPath)).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [userHook, { type: "command", command: "echo audit", timeout: 20 }],
          },
        ],
      },
    });

    // Target changes to project: removed from global, written to project.
    await reconcile(
      createManifest({ hooks: [{ ...managed, target: "project" }] }),
      createConfig(workspace)
    );
    expect(await readJson(workspace.globalSettingsPath)).toEqual({
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [userHook] }] },
    });
    expect(await readJson(workspace.projectSettingsPath)).toEqual({
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "echo audit", timeout: 5 }] },
        ],
      },
    });
  });

  it("treats a tool-scoped hook as the user's after the registry is lost", async () => {
    const workspace = await createWorkspace();
    const manifest = createManifest({
      hooks: [createHook({ id: "joyus:audit", matcher: "Bash", command: "echo audit" })],
    });

    await reconcile(manifest, createConfig(workspace));
    const installedText = await readFile(workspace.globalSettingsPath, "utf8");
    await rm(workspace.registryPath);

    // Nothing in settings.json marks the command as managed, so it is not re-adopted.
    await reconcile(manifest, createConfig(workspace));
    const registry = (await readJson(workspace.registryPath)) as {
      entries: Record<string, { command?: string }>;
    };
    expect(registry.entries["hook:PreToolUse:joyus:audit"]).not.toHaveProperty("command");

    // Known limit: a later revocation leaves it in place.
    await reconcile(createManifest({ hooks: [] }), createConfig(workspace));
    expect(await readFile(workspace.globalSettingsPath, "utf8")).toBe(installedText);
  });

  it("upgrades a registry entry written before ownership fields existed", async () => {
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
      },
      last_reconciled: installedAt,
    });

    const result = await reconcile(createManifest({ hooks: [createHook()] }), createConfig(workspace));

    expect(result).toMatchObject({ status: "success", entriesAdded: 0, entriesUpdated: 1 });
    const registry = (await readJson(workspace.registryPath)) as {
      entries: Record<string, { matcher?: string; command?: string; installed_at: string }>;
    };
    expect(registry.entries["hook:PreToolUse:joyus:hook"]).toMatchObject({
      matcher: "joyus:hook",
      command: "echo global hook",
      installed_at: installedAt,
    });
  });

  it("returns rolled_back when a settings file holds JSON that is not an object and there is no registry", async () => {
    const workspace = await createWorkspace();
    await mkdir(dirname(workspace.globalSettingsPath), { recursive: true });
    await writeFile(workspace.globalSettingsPath, "null", "utf8");

    const result = await reconcile(
      createManifest({ hooks: [createHook()] }),
      createConfig(workspace)
    );

    expect(result.status).toBe("rolled_back");
    expect(result.error).toContain("not a JSON object");
    expect(await readFile(workspace.globalSettingsPath, "utf8")).toBe("null");
    await expect(readFile(workspace.registryPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("repairs the registry from a hook list that contains null", async () => {
    const workspace = await createWorkspace();
    await writeJson(workspace.globalSettingsPath, {
      hooks: {
        PreToolUse: [
          null,
          {
            matcher: "joyus:hook",
            hooks: [{ type: "command", command: "echo old", timeout: 5 }],
          },
        ],
      },
    });

    const result = await reconcile(
      createManifest({ hooks: [createHook({ command: "echo new" })] }),
      createConfig(workspace)
    );

    expect(result).toMatchObject({ status: "success", entriesAdded: 0, entriesUpdated: 1 });
    expect(await readJson(workspace.globalSettingsPath)).toEqual({
      hooks: {
        PreToolUse: [
          null,
          {
            matcher: "joyus:hook",
            hooks: [{ type: "command", command: "echo new", timeout: 5 }],
          },
        ],
      },
    });
  });

  it("returns rolled_back instead of rejecting when registry repair throws", async () => {
    const workspace = await createWorkspace();
    await writeJson(workspace.globalSettingsPath, { existing: true });
    vi.spyOn(registryModule, "repairRegistry").mockRejectedValueOnce(new Error("repair failed"));

    const result = await reconcile(
      createManifest({ hooks: [createHook()] }),
      createConfig(workspace)
    );

    expect(result).toMatchObject({ status: "rolled_back", error: "repair failed" });
    expect(await readJson(workspace.globalSettingsPath)).toEqual({ existing: true });
  });
});
