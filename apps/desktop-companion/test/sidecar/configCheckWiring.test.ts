import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DistributionManifest, ReconcileResult } from "@joyus/settings-reconciler";
import {
  createConfigChangeHandler,
  createConfigCheckWiring,
  resolveSidecarManagedToolingConfigFromEnv,
} from "../../src/sidecar/configCheckWiring";

const FIXED_NOW = new Date("2026-04-02T12:00:00.000Z");
const tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

interface Workspace {
  root: string;
  globalSettingsPath: string;
  projectSettingsPath: string;
  registryPath: string;
  backupDir: string;
  cacheDir: string;
  skillsDir: string;
  tenantConfigPath: string;
}

async function createWorkspace(): Promise<Workspace> {
  const root = await mkdtemp(join(tmpdir(), "config-check-wiring-"));
  tempDirs.push(root);

  return {
    root,
    globalSettingsPath: join(root, "home", ".claude", "settings.json"),
    projectSettingsPath: join(root, "project", ".claude", "settings.json"),
    registryPath: join(root, "home", ".claude", ".joyus-managed.json"),
    backupDir: join(root, "backups"),
    cacheDir: join(root, "cache"),
    skillsDir: join(root, "skills"),
    tenantConfigPath: join(root, "tenant", "joyus-config.json"),
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function createManifest(
  workspace: Workspace,
  overrides: Partial<DistributionManifest> = {},
): DistributionManifest {
  return {
    schema_version: "1.0",
    tenant_id: "tenant-1",
    config_path: workspace.tenantConfigPath,
    bundles: {
      core: {
        version: "v1.0.0",
        hooks: [
          {
            id: "joyus:test-hook",
            event: "PreToolUse",
            matcher: "joyus:test-hook",
            command: "node ~/.claude/skills/test-hook-v1.mjs",
            target: "global",
          },
        ],
        mcpServers: [
          {
            id: "joyus:test-mcp",
            command: "node",
            args: ["~/.claude/skills/test-mcp.mjs"],
            env: { MODE: "managed" },
            target: "global",
          },
        ],
        config: {
          max_messages: 25,
        },
      },
    },
    ...overrides,
  };
}

function createReconcileResult(
  status: ReconcileResult["status"] = "success",
  registryPath = "/tmp/registry.json",
  error?: string,
): ReconcileResult {
  return {
    status,
    entriesAdded: 0,
    entriesUpdated: 0,
    entriesRemoved: 0,
    registryPath,
    ...(error !== undefined ? { error } : {}),
  };
}

describe("createConfigCheckWiring", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("starts the poller with the onSync callback and returns the handle", async () => {
    const stop = vi.fn();
    const onSync = vi.fn().mockResolvedValue(undefined);
    const startConfigCheckPollerFn = vi.fn((config) => {
      void config.onChangeDetected({
        schema_version: "1.0",
        tenant_id: "tenant-1",
        bundles: {},
      });

      return {
        stop,
        getState: () => ({ consecutiveFailures: 0 }),
      };
    });

    const handle = createConfigCheckWiring({
      manifestUrl: "https://example.com/manifest.json",
      intervalMs: 12_345,
      onSync,
      startConfigCheckPollerFn,
    });

    expect(startConfigCheckPollerFn).toHaveBeenCalledWith(
      expect.objectContaining({
        manifestUrl: "https://example.com/manifest.json",
        intervalMs: 12_345,
        onChangeDetected: onSync,
      }),
    );
    expect(handle.stop).toBe(stop);
    expect(onSync).toHaveBeenCalledOnce();
  });

  it("uses the real poller when no override is provided", async () => {
    const onSync = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        text: () =>
          Promise.resolve(
            JSON.stringify({
              schema_version: "1.0",
              tenant_id: "tenant-1",
              bundles: {},
            }),
          ),
      }),
    );

    const handle = createConfigCheckWiring({
      manifestUrl: "https://example.com/manifest.json",
      onSync,
      onPollError: vi.fn(),
    });

    handle.stop();
    await vi.runAllTimersAsync();

    expect(typeof handle.getState).toBe("function");
  });
});

describe("createConfigChangeHandler integration", () => {
  it("deploys managed hooks and MCPs, preserves user entries, and updates on the next manifest", async () => {
    const workspace = await createWorkspace();
    const userHook = {
      matcher: "user:custom-hook",
      hooks: [{ type: "command", command: "echo user hook" }],
    };
    const userMcp = {
      command: "python",
      args: ["user-mcp.py"],
      env: { MODE: "user" },
    };

    await writeJson(workspace.globalSettingsPath, {
      hooks: {
        PreToolUse: [userHook],
      },
      mcpServers: {
        "user:mcp": userMcp,
      },
    });

    const syncSkillsFn = vi.fn().mockResolvedValue({
      status: "success",
      filesUpdated: 2,
      metadataPath: join(workspace.skillsDir, ".sync-metadata.json"),
      version: "v1.0.0",
      noop: false,
    });

    const handler = createConfigChangeHandler({
      syncConfig: {
        repoUrl: "file:///repo.git",
        bundleName: "core",
        destDir: workspace.skillsDir,
        cacheDir: workspace.cacheDir,
      },
      reconcileConfig: {
        globalSettingsPath: workspace.globalSettingsPath,
        projectSettingsPath: workspace.projectSettingsPath,
        registryPath: workspace.registryPath,
        backupDir: workspace.backupDir,
        now: () => FIXED_NOW,
      },
      syncSkillsFn,
    });

    const manifestV1 = createManifest(workspace);
    await handler(manifestV1);

    expect(syncSkillsFn).toHaveBeenCalledWith(
      expect.objectContaining({
        repoUrl: "file:///repo.git",
        targetVersion: "v1.0.0",
        destDir: workspace.skillsDir,
        cacheDir: workspace.cacheDir,
      }),
    );

    const settingsAfterDeploy = await readJson<{
      hooks: Record<string, unknown[]>;
      mcpServers: Record<string, unknown>;
    }>(workspace.globalSettingsPath);
    const registryAfterDeploy = await readJson<{
      entries: Record<string, { bundle: string; manifest_version: string }>;
    }>(workspace.registryPath);
    const tenantConfigAfterDeploy = await readJson<{
      tenant_id: string;
      parameters: Record<string, unknown>;
    }>(workspace.tenantConfigPath);

    expect(settingsAfterDeploy.hooks["PreToolUse"]).toEqual([
      userHook,
      {
        matcher: "joyus:test-hook",
        hooks: [
          {
            type: "command",
            command: "node ~/.claude/skills/test-hook-v1.mjs",
            timeout: 5,
          },
        ],
      },
    ]);
    expect(settingsAfterDeploy.mcpServers).toEqual({
      "user:mcp": userMcp,
      "joyus:test-mcp": {
        command: "node",
        args: ["~/.claude/skills/test-mcp.mjs"],
        env: { MODE: "managed" },
      },
    });
    expect(registryAfterDeploy.entries).toMatchObject({
      "hook:PreToolUse:joyus:test-hook": {
        bundle: "core",
        manifest_version: "v1.0.0",
      },
      "mcp:joyus:test-mcp": {
        bundle: "core",
        manifest_version: "v1.0.0",
      },
    });
    expect(tenantConfigAfterDeploy).toMatchObject({
      tenant_id: "tenant-1",
      parameters: {
        max_messages: 25,
      },
    });

    const manifestV2 = createManifest(workspace, {
      bundles: {
        core: {
          version: "v1.1.0",
          hooks: [
            {
              id: "joyus:test-hook",
              event: "PreToolUse",
              matcher: "joyus:test-hook",
              command: "node ~/.claude/skills/test-hook-v2.mjs",
              target: "global",
            },
          ],
          mcpServers: [
            {
              id: "joyus:test-mcp",
              command: "node",
              args: ["~/.claude/skills/test-mcp.mjs"],
              env: { MODE: "managed" },
              target: "global",
            },
          ],
          config: {
            max_messages: 50,
          },
        },
      },
    });

    await handler(manifestV2);

    const settingsAfterUpdate = await readJson<{
      hooks: Record<string, Array<Record<string, unknown>>>;
      mcpServers: Record<string, unknown>;
    }>(workspace.globalSettingsPath);
    const registryAfterUpdate = await readJson<{
      entries: Record<string, { bundle: string; manifest_version: string }>;
    }>(workspace.registryPath);
    const tenantConfigAfterUpdate = await readJson<{
      parameters: Record<string, unknown>;
    }>(workspace.tenantConfigPath);

    expect(settingsAfterUpdate.hooks["PreToolUse"]).toEqual([
      userHook,
      {
        matcher: "joyus:test-hook",
        hooks: [
          {
            type: "command",
            command: "node ~/.claude/skills/test-hook-v2.mjs",
            timeout: 5,
          },
        ],
      },
    ]);
    expect(settingsAfterUpdate.mcpServers["user:mcp"]).toEqual(userMcp);
    expect(
      registryAfterUpdate.entries["hook:PreToolUse:joyus:test-hook"]
        ?.manifest_version,
    ).toBe("v1.1.0");
    expect(tenantConfigAfterUpdate.parameters["max_messages"]).toBe(50);
  });

  it("removes managed entries on full revocation while preserving user config", async () => {
    const workspace = await createWorkspace();
    const userHook = {
      matcher: "user:custom-hook",
      hooks: [{ type: "command", command: "echo user hook" }],
    };
    const userMcp = {
      command: "python",
      args: ["user-mcp.py"],
      env: { MODE: "user" },
    };

    await writeJson(workspace.globalSettingsPath, {
      hooks: {
        PreToolUse: [userHook],
      },
      mcpServers: {
        "user:mcp": userMcp,
      },
    });

    const syncSkillsFn = vi.fn().mockResolvedValue({
      status: "success",
      filesUpdated: 1,
      metadataPath: join(workspace.skillsDir, ".sync-metadata.json"),
      version: "v1.0.0",
      noop: false,
    });

    const handler = createConfigChangeHandler({
      syncConfig: {
        repoUrl: "file:///repo.git",
        bundleName: "core",
        destDir: workspace.skillsDir,
        cacheDir: workspace.cacheDir,
      },
      reconcileConfig: {
        globalSettingsPath: workspace.globalSettingsPath,
        projectSettingsPath: workspace.projectSettingsPath,
        registryPath: workspace.registryPath,
        backupDir: workspace.backupDir,
        now: () => FIXED_NOW,
      },
      syncSkillsFn,
    });

    await handler(createManifest(workspace));
    await handler({
      schema_version: "1.0",
      tenant_id: "tenant-1",
      config_path: workspace.tenantConfigPath,
      bundles: {},
    });

    const settingsAfterRevocation = await readJson<{
      hooks: Record<string, unknown[]>;
      mcpServers: Record<string, unknown>;
    }>(workspace.globalSettingsPath);
    const registryAfterRevocation = await readJson<{
      entries: Record<string, unknown>;
    }>(workspace.registryPath);
    const tenantConfigAfterRevocation = await readJson<{
      parameters: Record<string, unknown>;
    }>(workspace.tenantConfigPath);

    expect(settingsAfterRevocation.hooks["PreToolUse"]).toEqual([userHook]);
    expect(settingsAfterRevocation.mcpServers).toEqual({
      "user:mcp": userMcp,
    });
    expect(registryAfterRevocation.entries).toEqual({});
    expect(tenantConfigAfterRevocation.parameters).toEqual({});
    expect(syncSkillsFn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        targetVersion: "v1.0.0",
      }),
    );
  });

  it("removes revoked bundles while keeping managed entries from remaining bundles", async () => {
    const workspace = await createWorkspace();

    const syncSkillsFn = vi.fn().mockResolvedValue({
      status: "success",
      filesUpdated: 2,
      metadataPath: join(workspace.skillsDir, ".sync-metadata.json"),
      version: "v1.0.0",
      noop: false,
    });

    const handler = createConfigChangeHandler({
      syncConfig: {
        repoUrl: "file:///repo.git",
        destDir: workspace.skillsDir,
        cacheDir: workspace.cacheDir,
      },
      reconcileConfig: {
        globalSettingsPath: workspace.globalSettingsPath,
        projectSettingsPath: workspace.projectSettingsPath,
        registryPath: workspace.registryPath,
        backupDir: workspace.backupDir,
        now: () => FIXED_NOW,
      },
      syncSkillsFn,
    });

    await handler({
      schema_version: "1.0",
      tenant_id: "tenant-1",
      config_path: workspace.tenantConfigPath,
      bundles: {
        "bundle-a": {
          version: "v1.0.0",
          hooks: [
            {
              id: "joyus:bundle-a-hook",
              event: "PreToolUse",
              matcher: "joyus:bundle-a-hook",
              command: "node bundle-a.mjs",
            },
          ],
        },
        "bundle-b": {
          version: "v1.0.0",
          mcpServers: [
            {
              id: "joyus:bundle-b-mcp",
              command: "node",
              args: ["bundle-b.mjs"],
            },
          ],
        },
      },
    });

    await handler({
      schema_version: "1.0",
      tenant_id: "tenant-1",
      config_path: workspace.tenantConfigPath,
      bundles: {
        "bundle-b": {
          version: "v1.0.0",
          mcpServers: [
            {
              id: "joyus:bundle-b-mcp",
              command: "node",
              args: ["bundle-b.mjs"],
            },
          ],
        },
      },
    });

    const settings = await readJson<{
      hooks?: Record<string, unknown[]>;
      mcpServers: Record<string, unknown>;
    }>(workspace.globalSettingsPath);
    const registry = await readJson<{
      entries: Record<string, { bundle: string }>;
    }>(workspace.registryPath);

    expect(settings.hooks).toBeUndefined();
    expect(settings.mcpServers).toEqual({
      "joyus:bundle-b-mcp": {
        command: "node",
        args: ["bundle-b.mjs"],
      },
    });
    expect(Object.keys(registry.entries)).toEqual(["mcp:joyus:bundle-b-mcp"]);
    expect(registry.entries["mcp:joyus:bundle-b-mcp"]?.bundle).toBe("bundle-b");
  });
});

describe("createConfigChangeHandler failure isolation", () => {
  it("skips reconcile on offline sync when there is no revocation, but still writes tenant config", async () => {
    const reconcileFn = vi.fn().mockResolvedValue(createReconcileResult());
    const resolveConfigPathFn = vi.fn().mockReturnValue("/tmp/from-manifest.json");
    const writeTenantConfigFn = vi.fn().mockResolvedValue(undefined);

    const handler = createConfigChangeHandler({
      syncConfig: {
        repoUrl: "file:///repo.git",
        bundleName: "core",
        destDir: "/tmp/skills",
        cacheDir: "/tmp/cache",
      },
      tenantConfigPath: "/tmp/tenant-config.json",
      syncSkillsFn: vi.fn().mockResolvedValue({
        status: "offline",
        filesUpdated: 0,
        metadataPath: "/tmp/meta.json",
        version: "v1.0.0",
        noop: true,
      }),
      reconcileFn,
      resolveConfigPathFn,
      writeTenantConfigFn,
    });

    await handler({
      schema_version: "1.0",
      tenant_id: "tenant-1",
      bundles: {
        core: {
          version: "v1.0.0",
          config: { enabled: true },
        },
      },
    });

    expect(reconcileFn).not.toHaveBeenCalled();
    expect(resolveConfigPathFn).not.toHaveBeenCalled();
    expect(writeTenantConfigFn).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: { enabled: true },
      }),
      "/tmp/tenant-config.json",
    );
  });

  it("still reconciles revocation manifests when sync is offline", async () => {
    const reconcileFn = vi.fn().mockResolvedValue(createReconcileResult());
    const writeTenantConfigFn = vi.fn().mockResolvedValue(undefined);

    const handler = createConfigChangeHandler({
      syncConfig: {
        repoUrl: "file:///repo.git",
        bundleName: "core",
        destDir: "/tmp/skills",
        cacheDir: "/tmp/cache",
      },
      initialManifest: {
        schema_version: "1.0",
        tenant_id: "tenant-1",
        bundles: {
          core: {
            version: "v1.0.0",
            hooks: [
              {
                id: "joyus:test-hook",
                event: "PreToolUse",
                matcher: "joyus:test-hook",
                command: "node hook.mjs",
              },
            ],
          },
        },
      },
      syncSkillsFn: vi.fn().mockResolvedValue({
        status: "offline",
        filesUpdated: 0,
        metadataPath: "/tmp/meta.json",
        version: "v1.0.0",
        noop: true,
      }),
      reconcileFn,
      writeTenantConfigFn,
    });

    await handler({
      schema_version: "1.0",
      tenant_id: "tenant-1",
      bundles: {},
    });

    expect(reconcileFn).toHaveBeenCalledOnce();
    expect(writeTenantConfigFn).toHaveBeenCalledOnce();
  });

  it("treats managed entry removal within the same bundle as a revocation", async () => {
    const reconcileFn = vi.fn().mockResolvedValue(createReconcileResult());

    const handler = createConfigChangeHandler({
      syncConfig: {
        repoUrl: "file:///repo.git",
        bundleName: "core",
        destDir: "/tmp/skills",
        cacheDir: "/tmp/cache",
      },
      initialManifest: {
        schema_version: "1.0",
        tenant_id: "tenant-1",
        bundles: {
          core: {
            version: "v1.0.0",
            hooks: [
              {
                id: "joyus:test-hook",
                event: "PreToolUse",
                matcher: "joyus:test-hook",
                command: "node hook.mjs",
              },
            ],
          },
        },
      },
      syncSkillsFn: vi.fn().mockResolvedValue({
        status: "offline",
        filesUpdated: 0,
        metadataPath: "/tmp/meta.json",
        version: "v1.0.0",
        noop: true,
      }),
      reconcileFn,
      writeTenantConfigFn: vi.fn().mockResolvedValue(undefined),
    });

    await handler({
      schema_version: "1.0",
      tenant_id: "tenant-1",
      bundles: {
        core: {
          version: "v1.0.0",
          hooks: [],
        },
      },
    });

    expect(reconcileFn).toHaveBeenCalledOnce();
  });

  it("compares manifests correctly when bundles only define MCP servers", async () => {
    const reconcileFn = vi.fn().mockResolvedValue(createReconcileResult());

    const handler = createConfigChangeHandler({
      syncConfig: {
        repoUrl: "file:///repo.git",
        bundleName: "core",
        destDir: "/tmp/skills",
        cacheDir: "/tmp/cache",
      },
      initialManifest: {
        schema_version: "1.0",
        tenant_id: "tenant-1",
        bundles: {
          core: {
            version: "v1.0.0",
            mcpServers: [
              {
                id: "joyus:test-mcp",
                command: "node",
                args: ["server.mjs"],
              },
            ],
          },
        },
      },
      syncSkillsFn: vi.fn().mockResolvedValue({
        status: "success",
        filesUpdated: 1,
        metadataPath: "/tmp/meta.json",
        version: "v1.0.0",
        noop: false,
      }),
      reconcileFn,
      writeTenantConfigFn: vi.fn().mockResolvedValue(undefined),
    });

    await handler({
      schema_version: "1.0",
      tenant_id: "tenant-1",
      bundles: {
        core: {
          version: "v1.0.0",
          mcpServers: [
            {
              id: "joyus:test-mcp",
              command: "node",
              args: ["server.mjs"],
            },
          ],
        },
      },
    });

    expect(reconcileFn).toHaveBeenCalledOnce();
  });

  it("reconciles an initial empty manifest when no target version can be resolved", async () => {
    const logger = {
      error: vi.fn(),
      warn: vi.fn(),
    };
    const reconcileFn = vi.fn().mockResolvedValue(createReconcileResult());
    const writeTenantConfigFn = vi.fn().mockResolvedValue(undefined);

    const handler = createConfigChangeHandler({
      syncConfig: {
        repoUrl: "file:///repo.git",
        destDir: "/tmp/skills",
        cacheDir: "/tmp/cache",
      },
      logger,
      reconcileFn,
      writeTenantConfigFn,
    });

    await handler({
      schema_version: "1.0",
      tenant_id: "tenant-1",
      bundles: {},
    });

    expect(logger.warn).toHaveBeenCalledWith(
      "configCheckWiring: skipping skill sync because no target version could be resolved.",
    );
    expect(reconcileFn).toHaveBeenCalledOnce();
    expect(writeTenantConfigFn).toHaveBeenCalledOnce();
  });

  it("logs non-success sync results, reconcile failures, and tenant config write failures", async () => {
    const logger = {
      error: vi.fn(),
      warn: vi.fn(),
    };
    const writeTenantConfigFn = vi
      .fn()
      .mockRejectedValue(new Error("disk full"));

    const handler = createConfigChangeHandler({
      syncConfig: {
        repoUrl: "file:///repo.git",
        bundleName: "core",
        destDir: "/tmp/skills",
        cacheDir: "/tmp/cache",
      },
      logger,
      syncSkillsFn: vi.fn().mockResolvedValue({
        status: "locked",
        filesUpdated: 0,
        metadataPath: "/tmp/meta.json",
        noop: true,
      }),
      reconcileFn: vi.fn().mockResolvedValue(
        createReconcileResult("rolled_back", "/tmp/registry.json", "rollback"),
      ),
      writeTenantConfigFn,
    });

    await handler({
      schema_version: "1.0",
      tenant_id: "tenant-1",
      bundles: {
        core: {
          version: "v1.0.0",
          config: { enabled: true },
        },
      },
    });

    expect(logger.error).toHaveBeenCalledWith(
      "configCheckWiring: skill sync returned locked.",
    );
    expect(logger.error).toHaveBeenCalledWith(
      "configCheckWiring: tenant config write failed: disk full",
    );
  });

  it("logs rolled-back reconcile results after a successful sync", async () => {
    const logger = {
      error: vi.fn(),
      warn: vi.fn(),
    };

    const handler = createConfigChangeHandler({
      syncConfig: {
        repoUrl: "file:///repo.git",
        bundleName: "core",
        destDir: "/tmp/skills",
        cacheDir: "/tmp/cache",
      },
      logger,
      syncSkillsFn: vi.fn().mockResolvedValue({
        status: "success",
        filesUpdated: 1,
        metadataPath: "/tmp/meta.json",
        version: "v1.0.0",
        noop: false,
      }),
      reconcileFn: vi
        .fn()
        .mockResolvedValue(
          createReconcileResult("rolled_back", "/tmp/registry.json", "rollback"),
        ),
      writeTenantConfigFn: vi.fn().mockResolvedValue(undefined),
    });

    await handler({
      schema_version: "1.0",
      tenant_id: "tenant-1",
      bundles: {
        core: {
          version: "v1.0.0",
        },
      },
    });

    expect(logger.error).toHaveBeenCalledWith(
      "configCheckWiring: reconcile rolled back: rollback",
    );
  });

  it("falls back to unknown reconcile errors when the result omits an error message", async () => {
    const logger = {
      error: vi.fn(),
      warn: vi.fn(),
    };

    const rolledBackHandler = createConfigChangeHandler({
      syncConfig: {
        repoUrl: "file:///repo.git",
        bundleName: "core",
        destDir: "/tmp/skills",
        cacheDir: "/tmp/cache",
      },
      logger,
      syncSkillsFn: vi.fn().mockResolvedValue({
        status: "success",
        filesUpdated: 1,
        metadataPath: "/tmp/meta.json",
        version: "v1.0.0",
        noop: false,
      }),
      reconcileFn: vi.fn().mockResolvedValue(createReconcileResult("rolled_back")),
      writeTenantConfigFn: vi.fn().mockResolvedValue(undefined),
    });

    await rolledBackHandler({
      schema_version: "1.0",
      tenant_id: "tenant-1",
      bundles: {
        core: {
          version: "v1.0.0",
        },
      },
    });

    const errorHandler = createConfigChangeHandler({
      syncConfig: {
        repoUrl: "file:///repo.git",
        bundleName: "core",
        destDir: "/tmp/skills",
        cacheDir: "/tmp/cache",
      },
      logger,
      syncSkillsFn: vi.fn().mockResolvedValue({
        status: "success",
        filesUpdated: 1,
        metadataPath: "/tmp/meta.json",
        version: "v1.0.0",
        noop: false,
      }),
      reconcileFn: vi.fn().mockResolvedValue(createReconcileResult("error")),
      writeTenantConfigFn: vi.fn().mockResolvedValue(undefined),
    });

    await errorHandler({
      schema_version: "1.0",
      tenant_id: "tenant-1",
      bundles: {
        core: {
          version: "v1.0.0",
        },
      },
    });

    expect(logger.error).toHaveBeenCalledWith(
      "configCheckWiring: reconcile rolled back: unknown error",
    );
    expect(logger.error).toHaveBeenCalledWith(
      "configCheckWiring: reconcile failed: unknown error",
    );
  });

  it("logs sync exceptions, reconcile exceptions and error statuses", async () => {
    const logger = {
      error: vi.fn(),
      warn: vi.fn(),
    };
    const writeTenantConfigFn = vi.fn().mockResolvedValue(undefined);

    const throwingHandler = createConfigChangeHandler({
      syncConfig: {
        repoUrl: "file:///repo.git",
        bundleName: "core",
        destDir: "/tmp/skills",
        cacheDir: "/tmp/cache",
      },
      logger,
      syncSkillsFn: vi.fn().mockRejectedValue(new Error("git exploded")),
      reconcileFn: vi.fn().mockRejectedValue(new Error("reconcile exploded")),
      writeTenantConfigFn,
    });

    await throwingHandler({
      schema_version: "1.0",
      tenant_id: "tenant-1",
      bundles: {
        core: {
          version: "v1.0.0",
        },
      },
    });

    const errorStatusHandler = createConfigChangeHandler({
      syncConfig: {
        repoUrl: "file:///repo.git",
        bundleName: "core",
        destDir: "/tmp/skills",
        cacheDir: "/tmp/cache",
      },
      logger,
      syncSkillsFn: vi.fn().mockResolvedValue({
        status: "success",
        filesUpdated: 1,
        metadataPath: "/tmp/meta.json",
        version: "v1.0.0",
        noop: false,
      }),
      reconcileFn: vi
        .fn()
        .mockResolvedValue(
          createReconcileResult("error", "/tmp/registry.json", "bad reconcile"),
        ),
      writeTenantConfigFn,
    });

    await errorStatusHandler({
      schema_version: "1.0",
      tenant_id: "tenant-1",
      bundles: {
        core: {
          version: "v1.0.0",
        },
      },
    });

    expect(logger.error).toHaveBeenCalledWith(
      "configCheckWiring: skill sync failed: git exploded",
    );
    expect(logger.error).toHaveBeenCalledWith(
      "configCheckWiring: reconcile failed: bad reconcile",
    );
  });

  it("logs thrown reconcile errors after a successful sync", async () => {
    const logger = {
      error: vi.fn(),
      warn: vi.fn(),
    };

    const handler = createConfigChangeHandler({
      syncConfig: {
        repoUrl: "file:///repo.git",
        bundleName: "core",
        destDir: "/tmp/skills",
        cacheDir: "/tmp/cache",
      },
      logger,
      syncSkillsFn: vi.fn().mockResolvedValue({
        status: "success",
        filesUpdated: 1,
        metadataPath: "/tmp/meta.json",
        version: "v1.0.0",
        noop: false,
      }),
      reconcileFn: vi.fn().mockRejectedValue(new Error("reconcile exploded")),
      writeTenantConfigFn: vi.fn().mockResolvedValue(undefined),
    });

    await handler({
      schema_version: "1.0",
      tenant_id: "tenant-1",
      bundles: {
        core: {
          version: "v1.0.0",
        },
      },
    });

    expect(logger.error).toHaveBeenCalledWith(
      "configCheckWiring: reconcile threw: reconcile exploded",
    );
  });

  it("logs ambiguous version resolution and skips reconcile unless the manifest is a revocation", async () => {
    const logger = {
      error: vi.fn(),
      warn: vi.fn(),
    };
    const reconcileFn = vi.fn().mockResolvedValue(createReconcileResult());

    const handler = createConfigChangeHandler({
      syncConfig: {
        repoUrl: "file:///repo.git",
        destDir: "/tmp/skills",
        cacheDir: "/tmp/cache",
      },
      logger,
      reconcileFn,
      writeTenantConfigFn: vi.fn().mockResolvedValue(undefined),
    });

    await handler({
      schema_version: "1.0",
      tenant_id: "tenant-1",
      bundles: {
        "bundle-a": { version: "v1.0.0" },
        "bundle-b": { version: "v2.0.0" },
      },
    });

    expect(logger.error).toHaveBeenCalledWith(
      "configCheckWiring: Unable to resolve skill-sync target version from manifest with multiple bundle versions; configure bundleName explicitly.",
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "configCheckWiring: skipping skill sync because no target version could be resolved.",
    );
    expect(reconcileFn).not.toHaveBeenCalled();
  });

  it("uses the default logger and non-Error string formatting paths without throwing", async () => {
    const handler = createConfigChangeHandler({
      syncConfig: {
        repoUrl: "file:///repo.git",
        bundleName: "core",
        destDir: "/tmp/skills",
        cacheDir: "/tmp/cache",
      },
      syncSkillsFn: vi.fn().mockRejectedValue("string failure"),
      writeTenantConfigFn: vi.fn().mockResolvedValue(undefined),
    });

    await expect(
      handler({
        schema_version: "1.0",
        tenant_id: "tenant-1",
        bundles: {
          core: {
            version: "v1.0.0",
          },
        },
      }),
    ).resolves.toBeUndefined();
  });
});

describe("resolveSidecarManagedToolingConfigFromEnv", () => {
  it("returns undefined when required env vars are missing", () => {
    expect(resolveSidecarManagedToolingConfigFromEnv({})).toBeUndefined();
  });

  it("reads manifest, sync, and reconcile config from env", () => {
    const config = resolveSidecarManagedToolingConfigFromEnv({
      JOYUS_MANAGED_TOOLING_MANIFEST_URL: "https://example.com/manifest.json",
      JOYUS_MANAGED_TOOLING_INTERVAL_MS: "60000",
      JOYUS_MANAGED_TOOLING_GLOBAL_SETTINGS_PATH: "/tmp/global.json",
      JOYUS_MANAGED_TOOLING_PROJECT_SETTINGS_PATH: "/tmp/project.json",
      JOYUS_MANAGED_TOOLING_REGISTRY_PATH: "/tmp/registry.json",
      JOYUS_MANAGED_TOOLING_BACKUP_DIR: "/tmp/backups",
      JOYUS_MANAGED_TOOLING_TENANT_CONFIG_PATH: "/tmp/tenant.json",
      SKILL_SYNC_REPO_URL: "file:///repo.git",
      SKILL_SYNC_DEST_DIR: "/tmp/skills",
      SKILL_SYNC_CACHE_DIR: "/tmp/cache",
      SKILL_SYNC_BUNDLE: "core",
    });

    expect(config).toEqual({
      manifestUrl: "https://example.com/manifest.json",
      intervalMs: 60000,
      syncConfig: {
        repoUrl: "file:///repo.git",
        destDir: "/tmp/skills",
        cacheDir: "/tmp/cache",
        bundleName: "core",
      },
      reconcileConfig: {
        globalSettingsPath: "/tmp/global.json",
        projectSettingsPath: "/tmp/project.json",
        registryPath: "/tmp/registry.json",
        backupDir: "/tmp/backups",
      },
      tenantConfigPath: "/tmp/tenant.json",
    });
  });

  it("falls back to default sync paths and ignores invalid interval values", () => {
    const config = resolveSidecarManagedToolingConfigFromEnv({
      JOYUS_MANAGED_TOOLING_MANIFEST_URL: "https://example.com/manifest.json",
      JOYUS_MANAGED_TOOLING_INTERVAL_MS: "not-a-number",
      SKILL_SYNC_REPO_URL: "file:///repo.git",
    });

    expect(config).toEqual({
      manifestUrl: "https://example.com/manifest.json",
      syncConfig: {
        repoUrl: "file:///repo.git",
        destDir: "~/.claude/skills",
        cacheDir: "~/.claude/.skill-sync-cache",
      },
      reconcileConfig: {},
    });
  });

  it("omits interval when the env does not provide one", () => {
    const config = resolveSidecarManagedToolingConfigFromEnv({
      JOYUS_MANAGED_TOOLING_MANIFEST_URL: "https://example.com/manifest.json",
      SKILL_SYNC_REPO_URL: "file:///repo.git",
    });

    expect(config?.intervalMs).toBeUndefined();
  });
});
