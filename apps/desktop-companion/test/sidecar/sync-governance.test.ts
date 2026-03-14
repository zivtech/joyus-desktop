import { describe, expect, it, vi } from "vitest";
import {
  createServices,
  registerSyncMethods,
  registerGovernanceMethods,
  registerErrorReporting,
  emitGovernanceDecision,
  type ServiceContainer,
  type ServiceDeps,
  type SyncState,
  type GovernanceDecisionEntry,
  type SyncIpcDeps,
  type TelemetryErrorDeps,
} from "../../src/sidecar/services";
import { createIpcHandler } from "../../src/sidecar/ipc-handler";
import type { IpcHandler } from "../../src/sidecar/ipc-handler";
import { scanSkills } from "../../src/sidecar/skill-scanner";
import type { SkillScannerDeps } from "../../src/sidecar/skill-scanner";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStubContainer(overrides?: Partial<ServiceContainer>): ServiceContainer {
  return {
    processManager: {
      spawnServer: vi.fn() as never,
      stopServer: vi.fn() as never,
      stopAll: vi.fn().mockResolvedValue(undefined) as never,
      isRunning: vi.fn().mockReturnValue(false) as never,
      getEntry: vi.fn().mockReturnValue(undefined) as never,
      writePidFile: vi.fn() as never,
      readPidFile: vi.fn() as never,
      cleanupOrphans: vi.fn() as never,
      startWatchdog: vi.fn() as never,
      stopWatchdog: vi.fn() as never,
    },
    registry: {
      registerServer: vi.fn() as never,
      unregisterServer: vi.fn() as never,
      startServer: vi.fn() as never,
      stopServer: vi.fn() as never,
      restartServer: vi.fn() as never,
      getStatus: vi.fn() as never,
      listServers: vi.fn().mockReturnValue([]) as never,
      startAll: vi.fn() as never,
      stopAll: vi.fn() as never,
    },
    configPoller: {
      start: vi.fn().mockResolvedValue(undefined) as never,
      stop: vi.fn() as never,
      getConfig: vi.fn().mockReturnValue({ mode: "off" as const, updatedAt: "" }) as never,
    },
    periodicSync: {
      start: vi.fn() as never,
      stop: vi.fn() as never,
      getStatus: vi.fn().mockReturnValue("idle" as const) as never,
    },
    ...overrides,
  };
}

function makeIpc(): { ipc: IpcHandler; notifications: Array<{ method: string; params: unknown }> } {
  const notifications: Array<{ method: string; params: unknown }> = [];
  const writeFn = vi.fn((data: string) => {
    const parsed = JSON.parse(data.trim()) as { method: string; params: unknown };
    notifications.push(parsed);
  });
  const ipc = createIpcHandler(writeFn);
  return { ipc, notifications };
}

function makeSyncState(overrides?: Partial<SyncState>): SyncState {
  return {
    status: "idle",
    version: null,
    timestamp: null,
    ...overrides,
  };
}

function makeSyncResult() {
  return {
    version: "1.2.0",
    syncedAt: "2026-03-14T00:00:00Z",
    fromCache: false,
    durationMs: 3200,
  };
}

function makeScannerDeps(entries: string[], metaByEntry: Record<string, string> = {}): SkillScannerDeps {
  return {
    readdir: vi.fn().mockResolvedValue(entries),
    readFile: vi.fn().mockImplementation(async (path: string) => {
      for (const [entry, meta] of Object.entries(metaByEntry)) {
        if (path.includes(entry)) return meta;
      }
      throw new Error("not found");
    }),
  };
}

function makeSyncIpcDeps(
  triggerSync: () => Promise<ReturnType<typeof makeSyncResult>>,
  scannerDeps: SkillScannerDeps,
  destDir = "/skills",
  bundleName = "default",
): SyncIpcDeps {
  return {
    syncConfig: { destDir, bundleName },
    triggerSync,
    scannerDeps,
  };
}

// ---------------------------------------------------------------------------
// T021: sync.trigger
// ---------------------------------------------------------------------------

describe("sync.trigger", () => {
  it("returns SyncResult and updates syncState on success", async () => {
    const { ipc } = makeIpc();
    const container = makeStubContainer();
    const syncState = makeSyncState();
    const result = makeSyncResult();
    const triggerSync = vi.fn().mockResolvedValue(result);
    const syncIpcDeps = makeSyncIpcDeps(triggerSync, makeScannerDeps([]));

    registerSyncMethods(ipc, container, syncIpcDeps, syncState);

    const raw = JSON.stringify({ jsonrpc: "2.0", method: "sync.trigger", id: 1 });
    const response = JSON.parse(await ipc.handleRequest(raw)) as { result: unknown };

    expect(response.result).toEqual(result);
    expect(syncState.status).toBe("synced");
    expect(syncState.version).toBe("1.2.0");
    expect(syncState.timestamp).toBe("2026-03-14T00:00:00Z");
  });

  it("emits state.syncCompleted notification on success", async () => {
    const { ipc, notifications } = makeIpc();
    const container = makeStubContainer();
    const syncState = makeSyncState();
    const result = makeSyncResult();
    const syncIpcDeps = makeSyncIpcDeps(vi.fn().mockResolvedValue(result), makeScannerDeps([]));

    registerSyncMethods(ipc, container, syncIpcDeps, syncState);

    await ipc.handleRequest(JSON.stringify({ jsonrpc: "2.0", method: "sync.trigger", id: 1 }));

    const notification = notifications.find((n) => n.method === "state.syncCompleted");
    expect(notification).toBeDefined();
    expect(notification?.params).toEqual({
      version: "1.2.0",
      fromCache: false,
      durationMs: 3200,
    });
  });

  it("sets status=error and emits state.error on failure", async () => {
    const { ipc, notifications } = makeIpc();
    const container = makeStubContainer();
    const syncState = makeSyncState();
    const triggerSync = vi.fn().mockRejectedValue(new Error("sync failed"));
    const syncIpcDeps = makeSyncIpcDeps(triggerSync, makeScannerDeps([]));

    registerSyncMethods(ipc, container, syncIpcDeps, syncState);

    const raw = JSON.stringify({ jsonrpc: "2.0", method: "sync.trigger", id: 1 });
    const response = JSON.parse(await ipc.handleRequest(raw)) as { error?: unknown };

    expect(response.error).toBeDefined();
    expect(syncState.status).toBe("error");

    const errNotification = notifications.find((n) => n.method === "state.error");
    expect(errNotification).toBeDefined();
    expect((errNotification?.params as Record<string, unknown>)["fatal"]).toBe(false);
  });

  it("handles non-Error thrown during sync", async () => {
    const { ipc, notifications } = makeIpc();
    const container = makeStubContainer();
    const syncState = makeSyncState();
    const triggerSync = vi.fn().mockRejectedValue("string error");
    const syncIpcDeps = makeSyncIpcDeps(triggerSync, makeScannerDeps([]));

    registerSyncMethods(ipc, container, syncIpcDeps, syncState);

    await ipc.handleRequest(JSON.stringify({ jsonrpc: "2.0", method: "sync.trigger", id: 1 }));

    expect(syncState.status).toBe("error");
    const errNotification = notifications.find((n) => n.method === "state.error");
    expect(errNotification).toBeDefined();
    expect((errNotification?.params as Record<string, unknown>)["message"]).toBe("string error");
  });
});

// ---------------------------------------------------------------------------
// T021: sync.status
// ---------------------------------------------------------------------------

describe("sync.status", () => {
  it("returns current sync state", async () => {
    const { ipc } = makeIpc();
    const container = makeStubContainer();
    const syncState = makeSyncState({ status: "synced", version: "2.0.0", timestamp: "2026-01-01T00:00:00Z" });
    const syncIpcDeps = makeSyncIpcDeps(vi.fn(), makeScannerDeps([]));

    registerSyncMethods(ipc, container, syncIpcDeps, syncState);

    const raw = JSON.stringify({ jsonrpc: "2.0", method: "sync.status", id: 2 });
    const response = JSON.parse(await ipc.handleRequest(raw)) as { result: unknown };

    expect(response.result).toEqual({
      status: "synced",
      version: "2.0.0",
      timestamp: "2026-01-01T00:00:00Z",
    });
  });

  it("returns null version and timestamp when never synced", async () => {
    const { ipc } = makeIpc();
    const container = makeStubContainer();
    const syncState = makeSyncState();
    const syncIpcDeps = makeSyncIpcDeps(vi.fn(), makeScannerDeps([]));

    registerSyncMethods(ipc, container, syncIpcDeps, syncState);

    const raw = JSON.stringify({ jsonrpc: "2.0", method: "sync.status", id: 3 });
    const response = JSON.parse(await ipc.handleRequest(raw)) as { result: Record<string, unknown> };

    expect(response.result["status"]).toBe("idle");
    expect(response.result["version"]).toBeNull();
    expect(response.result["timestamp"]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T021: skills.list
// ---------------------------------------------------------------------------

describe("skills.list", () => {
  it("returns skills with metadata from package.json", async () => {
    const { ipc } = makeIpc();
    const container = makeStubContainer();
    const syncState = makeSyncState();
    const scannerDeps = makeScannerDeps(
      ["skill-a", "skill-b"],
      {
        "skill-a": JSON.stringify({ name: "skill-a", version: "1.0.0" }),
        "skill-b": JSON.stringify({ name: "skill-b", version: "2.0.0" }),
      },
    );
    const syncIpcDeps = makeSyncIpcDeps(vi.fn(), scannerDeps, "/skills", "bundle-x");

    registerSyncMethods(ipc, container, syncIpcDeps, syncState);

    const raw = JSON.stringify({ jsonrpc: "2.0", method: "skills.list", id: 4 });
    const response = JSON.parse(await ipc.handleRequest(raw)) as { result: unknown[] };

    expect(response.result).toHaveLength(2);
    expect(response.result[0]).toEqual({
      name: "skill-a",
      version: "1.0.0",
      bundle: "bundle-x",
      path: "/skills/skill-a",
    });
  });

  it("falls back to entry name and 0.0.0 when package.json is missing", async () => {
    const { ipc } = makeIpc();
    const container = makeStubContainer();
    const syncState = makeSyncState();
    const scannerDeps = makeScannerDeps(["orphan"]);
    const syncIpcDeps = makeSyncIpcDeps(vi.fn(), scannerDeps);

    registerSyncMethods(ipc, container, syncIpcDeps, syncState);

    const raw = JSON.stringify({ jsonrpc: "2.0", method: "skills.list", id: 5 });
    const response = JSON.parse(await ipc.handleRequest(raw)) as { result: Array<{ name: string; version: string }> };

    expect(response.result[0]?.name).toBe("orphan");
    expect(response.result[0]?.version).toBe("0.0.0");
  });

  it("returns empty array when destDir does not exist", async () => {
    const { ipc } = makeIpc();
    const container = makeStubContainer();
    const syncState = makeSyncState();
    const scannerDeps: SkillScannerDeps = {
      readdir: vi.fn().mockRejectedValue(new Error("ENOENT")),
      readFile: vi.fn() as never,
    };
    const syncIpcDeps = makeSyncIpcDeps(vi.fn(), scannerDeps);

    registerSyncMethods(ipc, container, syncIpcDeps, syncState);

    const raw = JSON.stringify({ jsonrpc: "2.0", method: "skills.list", id: 6 });
    const response = JSON.parse(await ipc.handleRequest(raw)) as { result: unknown[] };

    expect(response.result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T022: governance.getMode
// ---------------------------------------------------------------------------

describe("governance.getMode", () => {
  it("returns current governance mode from configPoller", async () => {
    const { ipc } = makeIpc();
    const container = makeStubContainer({
      configPoller: {
        start: vi.fn().mockResolvedValue(undefined) as never,
        stop: vi.fn() as never,
        getConfig: vi.fn().mockReturnValue({ mode: "audit" as const, updatedAt: "" }) as never,
      },
    });
    const decisionLog: GovernanceDecisionEntry[] = [];

    registerGovernanceMethods(ipc, container, decisionLog);

    const raw = JSON.stringify({ jsonrpc: "2.0", method: "governance.getMode", id: 7 });
    const response = JSON.parse(await ipc.handleRequest(raw)) as { result: { mode: string } };

    expect(response.result).toEqual({ mode: "audit" });
  });

  it("returns enforce mode", async () => {
    const { ipc } = makeIpc();
    const container = makeStubContainer({
      configPoller: {
        start: vi.fn().mockResolvedValue(undefined) as never,
        stop: vi.fn() as never,
        getConfig: vi.fn().mockReturnValue({ mode: "enforce" as const, updatedAt: "" }) as never,
      },
    });
    const decisionLog: GovernanceDecisionEntry[] = [];

    registerGovernanceMethods(ipc, container, decisionLog);

    const raw = JSON.stringify({ jsonrpc: "2.0", method: "governance.getMode", id: 8 });
    const response = JSON.parse(await ipc.handleRequest(raw)) as { result: { mode: string } };

    expect(response.result.mode).toBe("enforce");
  });
});

// ---------------------------------------------------------------------------
// T022: governance.getDecisions
// ---------------------------------------------------------------------------

describe("governance.getDecisions", () => {
  it("returns all decisions when no limit specified", async () => {
    const { ipc } = makeIpc();
    const container = makeStubContainer();
    const decisionLog: GovernanceDecisionEntry[] = [
      { toolName: "tool1", serverName: "srv1", decision: "allow", mode: "audit" },
      { toolName: "tool2", serverName: "srv2", decision: "deny", mode: "enforce" },
    ];

    registerGovernanceMethods(ipc, container, decisionLog);

    const raw = JSON.stringify({ jsonrpc: "2.0", method: "governance.getDecisions", id: 9 });
    const response = JSON.parse(await ipc.handleRequest(raw)) as { result: unknown[] };

    expect(response.result).toHaveLength(2);
  });

  it("returns limited decisions when limit param provided", async () => {
    const { ipc } = makeIpc();
    const container = makeStubContainer();
    const decisionLog: GovernanceDecisionEntry[] = [
      { toolName: "t1", serverName: "s1", decision: "allow", mode: "off" },
      { toolName: "t2", serverName: "s2", decision: "audit", mode: "audit" },
      { toolName: "t3", serverName: "s3", decision: "deny", mode: "enforce" },
    ];

    registerGovernanceMethods(ipc, container, decisionLog);

    const raw = JSON.stringify({ jsonrpc: "2.0", method: "governance.getDecisions", params: { limit: 2 }, id: 10 });
    const response = JSON.parse(await ipc.handleRequest(raw)) as { result: Array<{ toolName: string }> };

    expect(response.result).toHaveLength(2);
    expect(response.result[0]?.toolName).toBe("t2");
    expect(response.result[1]?.toolName).toBe("t3");
  });

  it("handles null params gracefully", async () => {
    const { ipc } = makeIpc();
    const container = makeStubContainer();
    const decisionLog: GovernanceDecisionEntry[] = [
      { toolName: "tool1", serverName: "srv1", decision: "allow", mode: "off" },
    ];

    registerGovernanceMethods(ipc, container, decisionLog);

    const raw = JSON.stringify({ jsonrpc: "2.0", method: "governance.getDecisions", params: null, id: 11 });
    const response = JSON.parse(await ipc.handleRequest(raw)) as { result: unknown[] };

    expect(response.result).toHaveLength(1);
  });

  it("handles params without limit field", async () => {
    const { ipc } = makeIpc();
    const container = makeStubContainer();
    const decisionLog: GovernanceDecisionEntry[] = [
      { toolName: "tool1", serverName: "srv1", decision: "allow", mode: "off" },
    ];

    registerGovernanceMethods(ipc, container, decisionLog);

    const raw = JSON.stringify({ jsonrpc: "2.0", method: "governance.getDecisions", params: { other: true }, id: 12 });
    const response = JSON.parse(await ipc.handleRequest(raw)) as { result: unknown[] };

    expect(response.result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// T023: emitGovernanceDecision
// ---------------------------------------------------------------------------

describe("emitGovernanceDecision", () => {
  it("appends entry to decisionLog and sends notification", () => {
    const { ipc, notifications } = makeIpc();
    const decisionLog: GovernanceDecisionEntry[] = [];
    const entry: GovernanceDecisionEntry = {
      toolName: "jira_create_issue",
      serverName: "atlassian",
      decision: "allow",
      mode: "audit",
    };

    emitGovernanceDecision(ipc, decisionLog, entry);

    expect(decisionLog).toHaveLength(1);
    expect(decisionLog[0]).toEqual(entry);

    const notification = notifications.find((n) => n.method === "state.governanceDecision");
    expect(notification).toBeDefined();
    expect(notification?.params).toEqual(entry);
  });

  it("appends multiple entries", () => {
    const { ipc } = makeIpc();
    const decisionLog: GovernanceDecisionEntry[] = [];

    emitGovernanceDecision(ipc, decisionLog, { toolName: "a", serverName: "s", decision: "allow", mode: "off" });
    emitGovernanceDecision(ipc, decisionLog, { toolName: "b", serverName: "s", decision: "deny", mode: "enforce" });

    expect(decisionLog).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// T024: registerErrorReporting
// ---------------------------------------------------------------------------

describe("registerErrorReporting", () => {
  it("emits state.error notification on state.reportError", async () => {
    const { ipc, notifications } = makeIpc();
    const telemetryDeps: TelemetryErrorDeps = {
      emitTelemetry: vi.fn().mockResolvedValue(undefined),
      isOptedOut: vi.fn().mockReturnValue(false),
    };

    registerErrorReporting(ipc, telemetryDeps);

    const raw = JSON.stringify({
      jsonrpc: "2.0",
      method: "state.reportError",
      params: { source: "mymodule", message: "something broke" },
      id: 13,
    });
    const response = JSON.parse(await ipc.handleRequest(raw)) as { result: unknown };
    expect(response.result).toEqual({ ok: true });

    const notification = notifications.find((n) => n.method === "state.error");
    expect(notification).toBeDefined();
    expect(notification?.params).toEqual({
      source: "mymodule",
      message: "something broke",
      fatal: false,
    });
  });

  it("calls emitTelemetry when not opted out", async () => {
    const { ipc } = makeIpc();
    const emitTelemetry = vi.fn().mockResolvedValue(undefined);
    const telemetryDeps: TelemetryErrorDeps = {
      emitTelemetry,
      isOptedOut: vi.fn().mockReturnValue(false),
    };

    registerErrorReporting(ipc, telemetryDeps);

    await ipc.handleRequest(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "state.reportError",
        params: { source: "src", message: "msg" },
        id: 14,
      }),
    );

    expect(emitTelemetry).toHaveBeenCalledWith({
      toolName: "app_error",
      source: "src",
      message: "msg",
    });
  });

  it("skips emitTelemetry when opted out", async () => {
    const { ipc } = makeIpc();
    const emitTelemetry = vi.fn().mockResolvedValue(undefined);
    const telemetryDeps: TelemetryErrorDeps = {
      emitTelemetry,
      isOptedOut: vi.fn().mockReturnValue(true),
    };

    registerErrorReporting(ipc, telemetryDeps);

    await ipc.handleRequest(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "state.reportError",
        params: { source: "src", message: "msg" },
        id: 15,
      }),
    );

    expect(emitTelemetry).not.toHaveBeenCalled();
  });

  it("handles missing/invalid params gracefully", async () => {
    const { ipc, notifications } = makeIpc();
    const telemetryDeps: TelemetryErrorDeps = {
      emitTelemetry: vi.fn().mockResolvedValue(undefined),
      isOptedOut: vi.fn().mockReturnValue(false),
    };

    registerErrorReporting(ipc, telemetryDeps);

    const raw = JSON.stringify({
      jsonrpc: "2.0",
      method: "state.reportError",
      id: 16,
    });
    const response = JSON.parse(await ipc.handleRequest(raw)) as { result: unknown };
    expect(response.result).toEqual({ ok: true });

    const notification = notifications.find((n) => n.method === "state.error");
    expect(notification).toBeDefined();
    expect((notification?.params as Record<string, unknown>)["source"]).toBe("unknown");
    expect((notification?.params as Record<string, unknown>)["message"]).toBe("unknown error");
  });
});

// ---------------------------------------------------------------------------
// skill-scanner unit tests (for coverage)
// ---------------------------------------------------------------------------

describe("scanSkills", () => {
  it("parses skills with valid package.json", async () => {
    const deps = makeScannerDeps(
      ["skill-x"],
      { "skill-x": JSON.stringify({ name: "skill-x", version: "3.0.0" }) },
    );
    const result = await scanSkills("/dest", "bundle", deps);
    expect(result).toEqual([
      { name: "skill-x", version: "3.0.0", bundle: "bundle", path: "/dest/skill-x" },
    ]);
  });

  it("falls back when package.json has invalid JSON", async () => {
    const deps: SkillScannerDeps = {
      readdir: vi.fn().mockResolvedValue(["bad-skill"]),
      readFile: vi.fn().mockResolvedValue("{not valid"),
    };
    const result = await scanSkills("/dest", "bundle", deps);
    expect(result[0]?.name).toBe("bad-skill");
    expect(result[0]?.version).toBe("0.0.0");
  });

  it("falls back when package.json is not an object", async () => {
    const deps: SkillScannerDeps = {
      readdir: vi.fn().mockResolvedValue(["scalar-skill"]),
      readFile: vi.fn().mockResolvedValue(JSON.stringify("just a string")),
    };
    const result = await scanSkills("/dest", "bundle", deps);
    expect(result[0]?.name).toBe("scalar-skill");
    expect(result[0]?.version).toBe("0.0.0");
  });

  it("falls back when name field missing", async () => {
    const deps: SkillScannerDeps = {
      readdir: vi.fn().mockResolvedValue(["no-name"]),
      readFile: vi.fn().mockResolvedValue(JSON.stringify({ version: "1.0.0" })),
    };
    const result = await scanSkills("/dest", "bundle", deps);
    expect(result[0]?.name).toBe("no-name");
    expect(result[0]?.version).toBe("1.0.0");
  });

  it("falls back when version field missing", async () => {
    const deps: SkillScannerDeps = {
      readdir: vi.fn().mockResolvedValue(["no-ver"]),
      readFile: vi.fn().mockResolvedValue(JSON.stringify({ name: "no-ver" })),
    };
    const result = await scanSkills("/dest", "bundle", deps);
    expect(result[0]?.version).toBe("0.0.0");
  });

  it("returns empty array when readdir throws", async () => {
    const deps: SkillScannerDeps = {
      readdir: vi.fn().mockRejectedValue(new Error("ENOENT")),
      readFile: vi.fn() as never,
    };
    const result = await scanSkills("/dest", "bundle", deps);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// createServices integration smoke test
// ---------------------------------------------------------------------------

describe("createServices with sync/governance stubs", () => {
  it("wires up all services correctly", () => {
    const deps: ServiceDeps = {
      createProcessManager: () => ({
        spawnServer: vi.fn() as never,
        stopServer: vi.fn() as never,
        stopAll: vi.fn().mockResolvedValue(undefined) as never,
        isRunning: vi.fn().mockReturnValue(false) as never,
        getEntry: vi.fn().mockReturnValue(undefined) as never,
        writePidFile: vi.fn() as never,
        readPidFile: vi.fn() as never,
        cleanupOrphans: vi.fn() as never,
        startWatchdog: vi.fn() as never,
        stopWatchdog: vi.fn() as never,
      }),
      createRegistry: () => ({
        registerServer: vi.fn() as never,
        unregisterServer: vi.fn() as never,
        startServer: vi.fn() as never,
        stopServer: vi.fn() as never,
        restartServer: vi.fn() as never,
        getStatus: vi.fn() as never,
        listServers: vi.fn().mockReturnValue([]) as never,
        startAll: vi.fn() as never,
        stopAll: vi.fn() as never,
      }),
      createConfigPoller: () => ({
        start: vi.fn().mockResolvedValue(undefined) as never,
        stop: vi.fn() as never,
        getConfig: vi.fn().mockReturnValue({ mode: "off" as const, updatedAt: "" }) as never,
      }),
      createPeriodicSync: () => ({
        start: vi.fn() as never,
        stop: vi.fn() as never,
        getStatus: vi.fn().mockReturnValue("idle" as const) as never,
      }),
    };

    const container = createServices(deps);
    expect(container.processManager).toBeDefined();
    expect(container.registry).toBeDefined();
    expect(container.configPoller).toBeDefined();
    expect(container.periodicSync).toBeDefined();
  });
});
