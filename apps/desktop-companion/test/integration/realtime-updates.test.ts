/**
 * T065 — Dashboard real-time update verification.
 *
 * Verifies that state changes propagate from sidecar services to the IPC
 * notification channel within timing SLA (1s for server changes).
 * Tests: state.serverChanged, state.syncCompleted, state.governanceDecision.
 */
import { describe, expect, it, vi } from "vitest";
import {
  registerServerMethods,
  registerServerNotifications,
  registerSyncMethods,
  emitGovernanceDecision,
  type ServiceContainer,
  type SyncState,
  type SyncIpcDeps,
  type GovernanceDecisionEntry,
} from "../../src/sidecar/services";
import { createIpcHandler } from "../../src/sidecar/ipc-handler";
import type { ProcessManager, Registry } from "@joyus/mcp-registry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNotificationCapture() {
  const notifications: Array<{ method: string; params: unknown; receivedAt: number }> = [];
  const writeFn = vi.fn((data: string) => {
    const parsed = JSON.parse(data.trim()) as { method: string; params: unknown };
    notifications.push({ ...parsed, receivedAt: Date.now() });
  });
  const ipc = createIpcHandler(writeFn);
  return { ipc, notifications };
}

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
    } as ProcessManager,
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
    } as Registry,
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

function makeSyncState(overrides?: Partial<SyncState>): SyncState {
  return { status: "idle", version: null, timestamp: null, ...overrides };
}

function makeSyncIpcDeps(
  triggerSync: () => Promise<{ version: string; syncedAt: string; fromCache: boolean; durationMs: number }>,
  destDir = "/skills",
  bundleName = "default",
): SyncIpcDeps {
  return {
    syncConfig: { destDir, bundleName },
    triggerSync,
    scannerDeps: {
      readdir: vi.fn().mockResolvedValue([]) as never,
      readFile: vi.fn() as never,
    },
  };
}

// ---------------------------------------------------------------------------
// T065: state.serverChanged notification
// ---------------------------------------------------------------------------

describe("realtime-updates — state.serverChanged", () => {
  it("emits state.serverChanged notification synchronously when watchdog fires", () => {
    let onRestart: ((name: string) => void) | undefined;
    const pm: ProcessManager = {
      spawnServer: vi.fn() as never,
      stopServer: vi.fn() as never,
      stopAll: vi.fn().mockResolvedValue(undefined) as never,
      isRunning: vi.fn().mockReturnValue(false) as never,
      getEntry: vi.fn().mockReturnValue(undefined) as never,
      writePidFile: vi.fn() as never,
      readPidFile: vi.fn() as never,
      cleanupOrphans: vi.fn() as never,
      startWatchdog: vi.fn((_interval, _max, cb) => { onRestart = cb; }) as never,
      stopWatchdog: vi.fn() as never,
    };
    const registry: Registry = {
      registerServer: vi.fn() as never,
      unregisterServer: vi.fn() as never,
      startServer: vi.fn() as never,
      stopServer: vi.fn() as never,
      restartServer: vi.fn() as never,
      getStatus: vi.fn() as never,
      listServers: vi.fn().mockReturnValue([
        { name: "atlassian-mcp", config: { command: "node", args: [] }, status: "error", lastError: "exit code 1", enabled: true, restartCount: 1 },
      ]) as never,
      startAll: vi.fn() as never,
      stopAll: vi.fn() as never,
    };

    const { ipc, notifications } = makeNotificationCapture();
    registerServerMethods(ipc, registry);
    registerServerNotifications(ipc, pm, registry);

    const before = Date.now();
    onRestart!("atlassian-mcp");
    const after = Date.now();

    const notif = notifications.find((n) => n.method === "state.serverChanged");
    expect(notif).toBeDefined();

    const params = notif!.params as Record<string, unknown>;
    expect(params["name"]).toBe("atlassian-mcp");
    expect(params["status"]).toBe("error");
    expect(params["lastError"]).toBe("exit code 1");

    // Must arrive within 1 second (SLA from SC-006)
    expect(notif!.receivedAt - before).toBeLessThan(1000);
    expect(after - before).toBeLessThan(1000);
  });

  it("emits state.serverChanged with error status when server not found (max restarts)", () => {
    let onRestart: ((name: string) => void) | undefined;
    const pm: ProcessManager = {
      spawnServer: vi.fn() as never,
      stopServer: vi.fn() as never,
      stopAll: vi.fn().mockResolvedValue(undefined) as never,
      isRunning: vi.fn().mockReturnValue(false) as never,
      getEntry: vi.fn().mockReturnValue(undefined) as never,
      writePidFile: vi.fn() as never,
      readPidFile: vi.fn() as never,
      cleanupOrphans: vi.fn() as never,
      startWatchdog: vi.fn((_interval, _max, cb) => { onRestart = cb; }) as never,
      stopWatchdog: vi.fn() as never,
    };
    const registry: Registry = {
      registerServer: vi.fn() as never,
      unregisterServer: vi.fn() as never,
      startServer: vi.fn() as never,
      stopServer: vi.fn() as never,
      restartServer: vi.fn() as never,
      getStatus: vi.fn() as never,
      listServers: vi.fn().mockReturnValue([]) as never,
      startAll: vi.fn() as never,
      stopAll: vi.fn() as never,
    };

    const { ipc, notifications } = makeNotificationCapture();
    registerServerNotifications(ipc, pm, registry);

    onRestart!("crashed-server");

    const notif = notifications.find((n) => n.method === "state.serverChanged");
    expect(notif).toBeDefined();
    const params = notif!.params as Record<string, unknown>;
    expect(params["name"]).toBe("crashed-server");
    expect(params["status"]).toBe("error");
    expect(params["lastError"]).toBe("Max restarts exceeded");
    expect(params["restartCount"]).toBe(5);
  });

  it("measures latency for state.serverChanged within 1s SLA (SC-006)", () => {
    let onRestart: ((name: string) => void) | undefined;
    const pm: ProcessManager = {
      spawnServer: vi.fn() as never,
      stopServer: vi.fn() as never,
      stopAll: vi.fn().mockResolvedValue(undefined) as never,
      isRunning: vi.fn().mockReturnValue(false) as never,
      getEntry: vi.fn().mockReturnValue(undefined) as never,
      writePidFile: vi.fn() as never,
      readPidFile: vi.fn() as never,
      cleanupOrphans: vi.fn() as never,
      startWatchdog: vi.fn((_interval, _max, cb) => { onRestart = cb; }) as never,
      stopWatchdog: vi.fn() as never,
    };
    const container = makeStubContainer();
    const { ipc, notifications } = makeNotificationCapture();
    registerServerNotifications(ipc, pm, container.registry);

    const t0 = Date.now();
    onRestart!("test-server");
    const latencyMs = Date.now() - t0;

    const serverChangedNotifs = notifications.filter((n) => n.method === "state.serverChanged");
    expect(serverChangedNotifs.length).toBeGreaterThanOrEqual(1);
    expect(latencyMs).toBeLessThan(1000);
    console.log(`[SC-006] state.serverChanged latency: ${latencyMs}ms`);
  });
});

// ---------------------------------------------------------------------------
// T065: state.syncCompleted notification
// ---------------------------------------------------------------------------

describe("realtime-updates — state.syncCompleted", () => {
  it("emits state.syncCompleted notification on successful sync.trigger", async () => {
    const { ipc, notifications } = makeNotificationCapture();
    const container = makeStubContainer();
    const syncState = makeSyncState();
    const syncResult = { version: "2.1.0", syncedAt: "2026-03-14T12:00:00Z", fromCache: false, durationMs: 8500 };
    const syncIpcDeps = makeSyncIpcDeps(vi.fn().mockResolvedValue(syncResult));

    registerSyncMethods(ipc, container, syncIpcDeps, syncState);

    const t0 = Date.now();
    await ipc.handleRequest(JSON.stringify({ jsonrpc: "2.0", method: "sync.trigger", id: 1 }));
    const latencyMs = Date.now() - t0;

    const notif = notifications.find((n) => n.method === "state.syncCompleted");
    expect(notif).toBeDefined();

    const params = notif!.params as Record<string, unknown>;
    expect(params["version"]).toBe("2.1.0");
    expect(params["fromCache"]).toBe(false);
    expect(typeof params["durationMs"]).toBe("number");

    expect(latencyMs).toBeLessThan(1000);
    console.log(`[sync] state.syncCompleted latency: ${latencyMs}ms`);
  });

  it("emits state.error notification when sync fails", async () => {
    const { ipc, notifications } = makeNotificationCapture();
    const container = makeStubContainer();
    const syncState = makeSyncState();
    const syncIpcDeps = makeSyncIpcDeps(vi.fn().mockRejectedValue(new Error("network timeout")));

    registerSyncMethods(ipc, container, syncIpcDeps, syncState);

    await ipc.handleRequest(JSON.stringify({ jsonrpc: "2.0", method: "sync.trigger", id: 2 }));

    const errNotif = notifications.find((n) => n.method === "state.error");
    expect(errNotif).toBeDefined();
    expect((errNotif!.params as Record<string, unknown>)["fatal"]).toBe(false);
    expect((errNotif!.params as Record<string, unknown>)["source"]).toBe("sync");
  });
});

// ---------------------------------------------------------------------------
// T065: state.governanceDecision notification
// ---------------------------------------------------------------------------

describe("realtime-updates — state.governanceDecision", () => {
  it("emits state.governanceDecision notification synchronously", () => {
    const { ipc, notifications } = makeNotificationCapture();
    const decisionLog: GovernanceDecisionEntry[] = [];

    const entry: GovernanceDecisionEntry = {
      toolName: "jira_create_issue",
      serverName: "atlassian-mcp",
      decision: "allow",
      mode: "audit",
    };

    const t0 = Date.now();
    emitGovernanceDecision(ipc, decisionLog, entry);
    const latencyMs = Date.now() - t0;

    const notif = notifications.find((n) => n.method === "state.governanceDecision");
    expect(notif).toBeDefined();
    expect(notif!.params).toEqual(entry);
    expect(latencyMs).toBeLessThan(1000);
    console.log(`[governance] state.governanceDecision latency: ${latencyMs}ms`);
  });

  it("decision is appended to log and matches notification payload", () => {
    const { ipc } = makeNotificationCapture();
    const decisionLog: GovernanceDecisionEntry[] = [];

    const entry: GovernanceDecisionEntry = {
      toolName: "bash",
      serverName: "shell-mcp",
      decision: "deny",
      mode: "enforce",
    };
    emitGovernanceDecision(ipc, decisionLog, entry);

    expect(decisionLog).toHaveLength(1);
    expect(decisionLog[0]).toEqual(entry);
  });

  it("multiple governance decisions accumulate in log", () => {
    const { ipc } = makeNotificationCapture();
    const decisionLog: GovernanceDecisionEntry[] = [];

    emitGovernanceDecision(ipc, decisionLog, { toolName: "a", serverName: "s1", decision: "allow", mode: "audit" });
    emitGovernanceDecision(ipc, decisionLog, { toolName: "b", serverName: "s2", decision: "deny", mode: "enforce" });
    emitGovernanceDecision(ipc, decisionLog, { toolName: "c", serverName: "s3", decision: "audit", mode: "audit" });

    expect(decisionLog).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// T065: Notification schema contract validation
// ---------------------------------------------------------------------------

describe("realtime-updates — notification schema contracts", () => {
  it("state.serverChanged has name, status, restartCount fields", () => {
    let onRestart: ((name: string) => void) | undefined;
    const pm: ProcessManager = {
      spawnServer: vi.fn() as never,
      stopServer: vi.fn() as never,
      stopAll: vi.fn().mockResolvedValue(undefined) as never,
      isRunning: vi.fn().mockReturnValue(false) as never,
      getEntry: vi.fn().mockReturnValue(undefined) as never,
      writePidFile: vi.fn() as never,
      readPidFile: vi.fn() as never,
      cleanupOrphans: vi.fn() as never,
      startWatchdog: vi.fn((_i, _m, cb) => { onRestart = cb; }) as never,
      stopWatchdog: vi.fn() as never,
    };
    const registry: Registry = {
      registerServer: vi.fn() as never,
      unregisterServer: vi.fn() as never,
      startServer: vi.fn() as never,
      stopServer: vi.fn() as never,
      restartServer: vi.fn() as never,
      getStatus: vi.fn() as never,
      listServers: vi.fn().mockReturnValue([
        { name: "my-server", config: { command: "node", args: [] }, status: "running", enabled: true, restartCount: 3 },
      ]) as never,
      startAll: vi.fn() as never,
      stopAll: vi.fn() as never,
    };

    const { ipc, notifications } = makeNotificationCapture();
    registerServerNotifications(ipc, pm, registry);
    onRestart!("my-server");

    const notif = notifications.find((n) => n.method === "state.serverChanged");
    const params = notif!.params as Record<string, unknown>;
    expect("name" in params).toBe(true);
    expect("status" in params).toBe(true);
    expect("restartCount" in params).toBe(true);
    expect(typeof params["name"]).toBe("string");
    expect(typeof params["restartCount"]).toBe("number");
  });

  it("state.syncCompleted has version, fromCache, durationMs fields", async () => {
    const { ipc, notifications } = makeNotificationCapture();
    const container = makeStubContainer();
    const syncState = makeSyncState();
    const syncIpcDeps = makeSyncIpcDeps(vi.fn().mockResolvedValue({
      version: "3.0.0", syncedAt: "2026-03-14T00:00:00Z", fromCache: true, durationMs: 500,
    }));

    registerSyncMethods(ipc, container, syncIpcDeps, syncState);
    await ipc.handleRequest(JSON.stringify({ jsonrpc: "2.0", method: "sync.trigger", id: 5 }));

    const notif = notifications.find((n) => n.method === "state.syncCompleted");
    const params = notif!.params as Record<string, unknown>;
    expect("version" in params).toBe(true);
    expect("fromCache" in params).toBe(true);
    expect("durationMs" in params).toBe(true);
  });

  it("state.governanceDecision has toolName, serverName, decision, mode fields", () => {
    const { ipc, notifications } = makeNotificationCapture();
    const decisionLog: GovernanceDecisionEntry[] = [];
    emitGovernanceDecision(ipc, decisionLog, {
      toolName: "read_file", serverName: "fs-mcp", decision: "audit", mode: "audit",
    });

    const notif = notifications.find((n) => n.method === "state.governanceDecision");
    const params = notif!.params as Record<string, unknown>;
    expect("toolName" in params).toBe(true);
    expect("serverName" in params).toBe(true);
    expect("decision" in params).toBe(true);
    expect("mode" in params).toBe(true);
  });
});
