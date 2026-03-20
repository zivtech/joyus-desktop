import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createUsageCollector,
  registerUsageMethods,
  type UsageCollectorDeps,
  type UsageEvent,
} from "../../src/sidecar/usage-collector";
import {
  createServices,
  registerOnboarding,
  registerAllMethods,
  type ServiceDeps,
  type OnboardingParams,
  type OnboardingResult,
} from "../../src/sidecar/services";
import type { IpcHandler, MethodHandler } from "../../src/sidecar/ipc-handler";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type InvokableMockIpc = IpcHandler & {
  notifications: Array<{ method: string; params: unknown }>;
  _invoke: (method: string, params: unknown) => Promise<unknown>;
};

function makeIpc(): InvokableMockIpc {
  const methods = new Map<string, MethodHandler>();
  const notifications: Array<{ method: string; params: unknown }> = [];

  const mock = {
    notifications,
    handleRequest: vi.fn() as never,
    registerMethod: vi.fn((name: string, handler: MethodHandler) => {
      methods.set(name, handler);
    }) as never,
    sendNotification: vi.fn((method: string, params: unknown) => {
      notifications.push({ method, params });
    }) as never,
    _invoke: async (method: string, params: unknown): Promise<unknown> => {
      const h = methods.get(method);
      if (!h) throw new Error(`Method ${method} not registered`);
      return h(params);
    },
  };

  return mock as unknown as InvokableMockIpc;
}

function makeDeps(overrides?: Partial<UsageCollectorDeps>): UsageCollectorDeps {
  return {
    nowFn: vi.fn().mockReturnValue("2026-03-14T00:00:00.000Z"),
    pruneAfterDays: 30,
    ...overrides,
  };
}

function makeStubServiceDeps(overrides?: Partial<ServiceDeps>): ServiceDeps {
  return {
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
      startAll: vi.fn().mockReturnValue([]) as never,
      stopAll: vi.fn() as never,
    }),
    createConfigPoller: () => ({
      start: vi.fn().mockResolvedValue(undefined) as never,
      stop: vi.fn() as never,
      getConfig: vi.fn().mockReturnValue({ mode: "off", updatedAt: "" }) as never,
    }),
    createPeriodicSync: () => ({
      start: vi.fn() as never,
      stop: vi.fn() as never,
      getStatus: vi.fn().mockReturnValue("idle" as const) as never,
    }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// T026: UsageCollector — recordEvent
// ---------------------------------------------------------------------------

describe("createUsageCollector", () => {
  it("recordEvent sends usage.record notification with full event", () => {
    const ipc = makeIpc();
    const deps = makeDeps();
    const collector = createUsageCollector(ipc, deps);

    collector.recordEvent({
      eventType: "tool_call",
      source: "server-a",
      action: "bash",
      outcome: "success",
      durationMs: 42,
      metadata: { tool: "bash" },
    });

    expect(ipc.sendNotification).toHaveBeenCalledOnce();
    expect(ipc.notifications[0]).toMatchObject({
      method: "usage.record",
      params: {
        eventType: "tool_call",
        source: "server-a",
        action: "bash",
        outcome: "success",
        durationMs: 42,
        createdAt: "2026-03-14T00:00:00.000Z",
      },
    });
  });

  it("recordEvent attaches createdAt from nowFn", () => {
    const ipc = makeIpc();
    const nowFn = vi.fn().mockReturnValueOnce("2026-01-01T00:00:00.000Z");
    const collector = createUsageCollector(ipc, makeDeps({ nowFn }));

    collector.recordEvent({
      eventType: "sync",
      source: "skill-sync",
      action: "sync_complete",
      outcome: "success",
      durationMs: 100,
      metadata: {},
    });

    const sent = ipc.notifications[0]?.params as UsageEvent;
    expect(sent.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("stores multiple events internally", () => {
    const ipc = makeIpc();
    const collector = createUsageCollector(ipc, makeDeps());

    collector.recordEvent({
      eventType: "tool_call",
      source: "s",
      action: "a",
      outcome: "success",
      durationMs: 1,
      metadata: {},
    });
    collector.recordEvent({
      eventType: "sync",
      source: "s",
      action: "b",
      outcome: "error",
      durationMs: 2,
      metadata: {},
    });

    expect(collector.queryEvents({})).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// T027: usage.query
// ---------------------------------------------------------------------------

describe("queryEvents", () => {
  function makeCollectorWithEvents() {
    const ipc = makeIpc();
    let tick = 0;
    const nowFn = vi.fn(() => `2026-03-${String(14 + tick++).padStart(2, "0")}T00:00:00.000Z`);
    const collector = createUsageCollector(ipc, makeDeps({ nowFn }));

    collector.recordEvent({ eventType: "tool_call", source: "server-a", action: "bash", outcome: "success", durationMs: 10, metadata: {} });
    collector.recordEvent({ eventType: "sync", source: "skill-sync", action: "sync_complete", outcome: "success", durationMs: 20, metadata: {} });
    collector.recordEvent({ eventType: "tool_call", source: "server-b", action: "read", outcome: "error", durationMs: 5, metadata: {} });
    collector.recordEvent({ eventType: "governance_decision", source: "governance", action: "allow", outcome: "success", durationMs: 1, metadata: {} });
    collector.recordEvent({ eventType: "server_event", source: "server-a", action: "crash", outcome: "error", durationMs: 0, metadata: {} });

    return collector;
  }

  it("returns all events when no filters", () => {
    const collector = makeCollectorWithEvents();
    expect(collector.queryEvents({})).toHaveLength(5);
  });

  it("filters by eventType", () => {
    const collector = makeCollectorWithEvents();
    const result = collector.queryEvents({ eventType: "tool_call" });
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.eventType === "tool_call")).toBe(true);
  });

  it("filters by source", () => {
    const collector = makeCollectorWithEvents();
    const result = collector.queryEvents({ source: "server-a" });
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.source === "server-a")).toBe(true);
  });

  it("filters by since (inclusive)", () => {
    const ipc = makeIpc();
    let call = 0;
    const dates = ["2026-03-10T00:00:00.000Z", "2026-03-15T00:00:00.000Z", "2026-03-20T00:00:00.000Z"];
    const nowFn = vi.fn(() => dates[call++] ?? dates[2]!);
    const collector = createUsageCollector(ipc, makeDeps({ nowFn }));
    for (let i = 0; i < 3; i++) {
      collector.recordEvent({ eventType: "tool_call", source: "s", action: "a", outcome: "success", durationMs: 0, metadata: {} });
    }
    const result = collector.queryEvents({ since: "2026-03-15T00:00:00.000Z" });
    expect(result).toHaveLength(2);
  });

  it("applies limit", () => {
    const collector = makeCollectorWithEvents();
    const result = collector.queryEvents({ limit: 2 });
    expect(result).toHaveLength(2);
  });

  it("combines filters: eventType + limit", () => {
    const collector = makeCollectorWithEvents();
    const result = collector.queryEvents({ eventType: "tool_call", limit: 1 });
    expect(result).toHaveLength(1);
    expect(result[0]?.eventType).toBe("tool_call");
  });
});

// ---------------------------------------------------------------------------
// T027: usage.summary
// ---------------------------------------------------------------------------

describe("getSummary", () => {
  it("counts totalToolCalls, totalSyncs, totalGovernanceDecisions, serverCrashes", () => {
    const ipc = makeIpc();
    const nowFn = vi.fn().mockReturnValue(new Date().toISOString());
    const collector = createUsageCollector(ipc, makeDeps({ nowFn }));

    collector.recordEvent({ eventType: "tool_call", source: "s", action: "a", outcome: "success", durationMs: 0, metadata: {} });
    collector.recordEvent({ eventType: "tool_call", source: "s", action: "b", outcome: "success", durationMs: 0, metadata: {} });
    collector.recordEvent({ eventType: "sync", source: "s", action: "sync", outcome: "success", durationMs: 0, metadata: {} });
    collector.recordEvent({ eventType: "governance_decision", source: "gov", action: "allow", outcome: "success", durationMs: 0, metadata: {} });
    collector.recordEvent({ eventType: "server_event", source: "s", action: "crash", outcome: "error", durationMs: 0, metadata: {} });

    const summary = collector.getSummary(30);
    expect(summary.totalToolCalls).toBe(2);
    expect(summary.totalSyncs).toBe(1);
    expect(summary.totalGovernanceDecisions).toBe(1);
    expect(summary.serverCrashes).toBe(1);
  });

  it("returns topTools grouped by action, sorted desc, max 10", () => {
    const ipc = makeIpc();
    const nowFn = vi.fn().mockReturnValue(new Date().toISOString());
    const collector = createUsageCollector(ipc, makeDeps({ nowFn }));

    for (let i = 0; i < 5; i++) {
      collector.recordEvent({ eventType: "tool_call", source: "s", action: "bash", outcome: "success", durationMs: 0, metadata: {} });
    }
    for (let i = 0; i < 2; i++) {
      collector.recordEvent({ eventType: "tool_call", source: "s", action: "read", outcome: "success", durationMs: 0, metadata: {} });
    }

    const summary = collector.getSummary(30);
    expect(summary.topTools[0]).toEqual({ action: "bash", count: 5 });
    expect(summary.topTools[1]).toEqual({ action: "read", count: 2 });
    expect(summary.topTools.length).toBeLessThanOrEqual(10);
  });

  it("returns topServers grouped by source, sorted desc, max 10", () => {
    const ipc = makeIpc();
    const nowFn = vi.fn().mockReturnValue(new Date().toISOString());
    const collector = createUsageCollector(ipc, makeDeps({ nowFn }));

    for (let i = 0; i < 3; i++) {
      collector.recordEvent({ eventType: "tool_call", source: "server-a", action: "a", outcome: "success", durationMs: 0, metadata: {} });
    }
    collector.recordEvent({ eventType: "tool_call", source: "server-b", action: "a", outcome: "success", durationMs: 0, metadata: {} });

    const summary = collector.getSummary(30);
    expect(summary.topServers[0]).toEqual({ source: "server-a", count: 3 });
    expect(summary.topServers[1]).toEqual({ source: "server-b", count: 1 });
  });

  it("returns dailyCounts grouped by date, sorted asc", () => {
    const ipc = makeIpc();
    const dates = ["2026-03-10T12:00:00.000Z", "2026-03-10T13:00:00.000Z", "2026-03-12T00:00:00.000Z"];
    let idx = 0;
    const nowFn = vi.fn(() => dates[idx++] ?? dates[2]!);
    const collector = createUsageCollector(ipc, makeDeps({ nowFn }));

    for (let i = 0; i < 3; i++) {
      collector.recordEvent({ eventType: "tool_call", source: "s", action: "a", outcome: "success", durationMs: 0, metadata: {} });
    }

    const summary = collector.getSummary(30);
    expect(summary.dailyCounts).toEqual([
      { date: "2026-03-10", count: 2 },
      { date: "2026-03-12", count: 1 },
    ]);
  });

  it("excludes events older than `days`", () => {
    const ipc = makeIpc();
    const old = new Date(Date.now() - 61 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date().toISOString();
    let call = 0;
    const nowFn = vi.fn(() => (call++ === 0 ? old : recent));
    const collector = createUsageCollector(ipc, makeDeps({ nowFn }));

    collector.recordEvent({ eventType: "tool_call", source: "s", action: "a", outcome: "success", durationMs: 0, metadata: {} });
    collector.recordEvent({ eventType: "tool_call", source: "s", action: "b", outcome: "success", durationMs: 0, metadata: {} });

    const summary = collector.getSummary(30);
    expect(summary.totalToolCalls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// T027: IPC registration
// ---------------------------------------------------------------------------

describe("registerUsageMethods", () => {
  it("registers usage.query method that delegates to collector", async () => {
    const ipc = makeIpc();
    const collector = createUsageCollector(ipc, makeDeps());
    registerUsageMethods(ipc, collector);

    collector.recordEvent({ eventType: "tool_call", source: "s", action: "x", outcome: "success", durationMs: 0, metadata: {} });

    const result = await ipc._invoke("usage.query", {});
    expect(Array.isArray(result)).toBe(true);
    expect((result as UsageEvent[]).length).toBe(1);
  });

  it("usage.query handles null params gracefully", async () => {
    const ipc = makeIpc();
    const collector = createUsageCollector(ipc, makeDeps());
    registerUsageMethods(ipc, collector);

    // passing null exercises the `params ?? {}` branch
    const result = await ipc._invoke("usage.query", null);
    expect(Array.isArray(result)).toBe(true);
  });

  it("registers usage.summary method that returns summary", async () => {
    const ipc = makeIpc();
    const nowFn = vi.fn().mockReturnValue(new Date().toISOString());
    const collector = createUsageCollector(ipc, makeDeps({ nowFn }));
    registerUsageMethods(ipc, collector);

    collector.recordEvent({ eventType: "sync", source: "s", action: "sync", outcome: "success", durationMs: 0, metadata: {} });

    const result = await ipc._invoke("usage.summary", { days: 30 }) as { totalSyncs: number };
    expect(result.totalSyncs).toBe(1);
  });

  it("usage.summary uses default 30 days when days not provided", async () => {
    const ipc = makeIpc();
    const nowFn = vi.fn().mockReturnValue(new Date().toISOString());
    const collector = createUsageCollector(ipc, makeDeps({ nowFn }));
    registerUsageMethods(ipc, collector);

    collector.recordEvent({ eventType: "tool_call", source: "s", action: "a", outcome: "success", durationMs: 0, metadata: {} });

    const result = await ipc._invoke("usage.summary", null) as { totalToolCalls: number };
    expect(result.totalToolCalls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// T028: 30-day pruning
// ---------------------------------------------------------------------------

describe("pruneOldEvents", () => {
  it("deletes events older than pruneAfterDays and returns count", () => {
    const ipc = makeIpc();
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date().toISOString();
    let call = 0;
    const nowFn = vi.fn(() => (call++ === 0 ? old : recent));
    const collector = createUsageCollector(ipc, makeDeps({ nowFn, pruneAfterDays: 30 }));

    collector.recordEvent({ eventType: "tool_call", source: "s", action: "a", outcome: "success", durationMs: 0, metadata: {} });
    collector.recordEvent({ eventType: "tool_call", source: "s", action: "b", outcome: "success", durationMs: 0, metadata: {} });

    const pruned = collector.pruneOldEvents();
    expect(pruned).toBe(1);
    expect(collector.queryEvents({})).toHaveLength(1);
  });

  it("preserves recent events", () => {
    const ipc = makeIpc();
    const nowFn = vi.fn().mockReturnValue(new Date().toISOString());
    const collector = createUsageCollector(ipc, makeDeps({ nowFn, pruneAfterDays: 30 }));

    for (let i = 0; i < 3; i++) {
      collector.recordEvent({ eventType: "tool_call", source: "s", action: "a", outcome: "success", durationMs: 0, metadata: {} });
    }

    const pruned = collector.pruneOldEvents();
    expect(pruned).toBe(0);
    expect(collector.queryEvents({})).toHaveLength(3);
  });

  it("returns 0 when no events exist", () => {
    const ipc = makeIpc();
    const collector = createUsageCollector(ipc, makeDeps());
    expect(collector.pruneOldEvents()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T029: onboarding.start
// ---------------------------------------------------------------------------

describe("registerOnboarding", () => {
  let ipc: InvokableMockIpc;

  beforeEach(() => {
    ipc = makeIpc();
  });

  function makeCollector() {
    return createUsageCollector(ipc, makeDeps({ nowFn: vi.fn().mockReturnValue(new Date().toISOString()) }));
  }

  function makeContainer(overrides?: Partial<ServiceDeps>) {
    return createServices(makeStubServiceDeps(overrides));
  }

  it("happy path returns success with serversStarted and skillsSynced", async () => {
    const container = makeContainer({
      createRegistry: () => ({
        registerServer: vi.fn() as never,
        unregisterServer: vi.fn() as never,
        startServer: vi.fn() as never,
        stopServer: vi.fn() as never,
        restartServer: vi.fn() as never,
        getStatus: vi.fn() as never,
        listServers: vi.fn().mockReturnValue([]) as never,
        startAll: vi.fn().mockReturnValue([
          { name: "a", config: { command: "x", args: [] }, status: "running", enabled: true, restartCount: 0 },
          { name: "b", config: { command: "y", args: [] }, status: "running", enabled: true, restartCount: 0 },
        ]) as never,
        stopAll: vi.fn() as never,
      }),
    });

    registerOnboarding(ipc, container, makeCollector());

    const params: OnboardingParams = { authToken: "tok", tenantId: "t1", workspaceId: "w1" };
    const result = await ipc._invoke("onboarding.start", params) as OnboardingResult;

    expect(result.success).toBe(true);
    expect(result.serversStarted).toBe(2);
    expect(result.skillsSynced).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("sends onboarding_complete config.set notification on success", async () => {
    const container = makeContainer();
    registerOnboarding(ipc, container, makeCollector());

    const params: OnboardingParams = { authToken: "tok", tenantId: "t1", workspaceId: "w1" };
    await ipc._invoke("onboarding.start", params);

    const configSetNotifications = ipc.notifications.filter((n) => n.method === "config.set");
    const completeFlagNotif = configSetNotifications.find(
      (n) => (n.params as { key: string }).key === "onboarding_complete",
    );
    expect(completeFlagNotif).toBeDefined();
    expect((completeFlagNotif?.params as { value: string }).value).toBe("true");
  });

  it("sends auth config.set notification with tenant/workspace info", async () => {
    const container = makeContainer();
    registerOnboarding(ipc, container, makeCollector());

    const params: OnboardingParams = { authToken: "myToken", tenantId: "tenant-1", workspaceId: "ws-1" };
    await ipc._invoke("onboarding.start", params);

    const authNotif = ipc.notifications.find(
      (n) => n.method === "config.set" && (n.params as { key: string }).key === "auth",
    );
    expect(authNotif).toBeDefined();
    const value = JSON.parse((authNotif?.params as { value: string }).value) as {
      authToken: string;
      tenantId: string;
      workspaceId: string;
    };
    expect(value.tenantId).toBe("tenant-1");
    expect(value.workspaceId).toBe("ws-1");
  });

  it("partial failure: registry throws — still returns partial success", async () => {
    const container = makeContainer({
      createRegistry: () => ({
        registerServer: vi.fn() as never,
        unregisterServer: vi.fn() as never,
        startServer: vi.fn() as never,
        stopServer: vi.fn() as never,
        restartServer: vi.fn() as never,
        getStatus: vi.fn() as never,
        listServers: vi.fn().mockReturnValue([]) as never,
        startAll: vi.fn().mockImplementation(() => { throw new Error("registry unavailable"); }) as never,
        stopAll: vi.fn() as never,
      }),
    });

    registerOnboarding(ipc, container, makeCollector());

    const params: OnboardingParams = { authToken: "tok", tenantId: "t1", workspaceId: "w1" };
    const result = await ipc._invoke("onboarding.start", params) as OnboardingResult;

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("servers"))).toBe(true);
    expect(result.skillsSynced).toBe(true);
  });

  it("partial failure: sync throws — still returns partial success", async () => {
    const container = makeContainer({
      createPeriodicSync: () => ({
        start: vi.fn().mockImplementation(() => { throw new Error("sync failed"); }) as never,
        stop: vi.fn() as never,
        getStatus: vi.fn().mockReturnValue("idle" as const) as never,
      }),
    });

    registerOnboarding(ipc, container, makeCollector());

    const params: OnboardingParams = { authToken: "tok", tenantId: "t1", workspaceId: "w1" };
    const result = await ipc._invoke("onboarding.start", params) as OnboardingResult;

    expect(result.success).toBe(false);
    expect(result.skillsSynced).toBe(false);
    expect(result.errors.some((e) => e.includes("sync"))).toBe(true);
  });

  it("partial failure: auth step throws non-Error — error message uses String()", async () => {
    const container = makeContainer();
    // Make recordEvent throw by making sendNotification on the collector's ipc throw
    const brokenIpc = makeIpc();
    const collector = createUsageCollector(brokenIpc, makeDeps({ nowFn: vi.fn().mockReturnValue(new Date().toISOString()) }));

    // Wrap the collector to force recordEvent to throw
    const throwingCollector = {
      ...collector,
      recordEvent: () => { throw "non-error string"; },
    };

    registerOnboarding(ipc, container, throwingCollector);

    const params: OnboardingParams = { authToken: "tok", tenantId: "t1", workspaceId: "w1" };
    const result = await ipc._invoke("onboarding.start", params) as OnboardingResult;

    expect(result.errors.some((e) => e.startsWith("auth:"))).toBe(true);
    expect(result.errors[0]).toBe("auth: non-error string");
  });

  it("partial failure: auth step throws Error — uses error.message", async () => {
    const container = makeContainer();
    const throwingCollector = {
      ...createUsageCollector(ipc, makeDeps()),
      recordEvent: () => { throw new Error("auth boom"); },
    };

    registerOnboarding(ipc, container, throwingCollector);

    const params: OnboardingParams = { authToken: "tok", tenantId: "t1", workspaceId: "w1" };
    const result = await ipc._invoke("onboarding.start", params) as OnboardingResult;

    expect(result.errors[0]).toBe("auth: auth boom");
  });

  it("servers error: non-Error throw uses String()", async () => {
    const container = makeContainer({
      createRegistry: () => ({
        registerServer: vi.fn() as never,
        unregisterServer: vi.fn() as never,
        startServer: vi.fn() as never,
        stopServer: vi.fn() as never,
        restartServer: vi.fn() as never,
        getStatus: vi.fn() as never,
        listServers: vi.fn().mockReturnValue([]) as never,
        startAll: vi.fn().mockImplementation(() => { throw "string-servers-error"; }) as never,
        stopAll: vi.fn() as never,
      }),
    });

    registerOnboarding(ipc, container, makeCollector());

    const result = await ipc._invoke("onboarding.start", { authToken: "t", tenantId: "t", workspaceId: "w" }) as OnboardingResult;
    expect(result.errors.some((e) => e === "servers: string-servers-error")).toBe(true);
  });

  it("sync error: non-Error throw uses String()", async () => {
    const container = makeContainer({
      createPeriodicSync: () => ({
        start: vi.fn().mockImplementation(() => { throw "string-sync-error"; }) as never,
        stop: vi.fn() as never,
        getStatus: vi.fn().mockReturnValue("idle" as const) as never,
      }),
    });

    registerOnboarding(ipc, container, makeCollector());

    const result = await ipc._invoke("onboarding.start", { authToken: "t", tenantId: "t", workspaceId: "w" }) as OnboardingResult;
    expect(result.errors.some((e) => e === "sync: string-sync-error")).toBe(true);
  });

  it("rejects null params with a descriptive error", async () => {
    const ipc = makeIpc();
    const container = makeContainer();
    registerOnboarding(ipc, container, makeCollector());
    await expect(ipc._invoke("onboarding.start", null)).rejects.toThrow("params must be an object");
  });

  it("rejects missing authToken", async () => {
    const ipc = makeIpc();
    const container = makeContainer();
    registerOnboarding(ipc, container, makeCollector());
    await expect(ipc._invoke("onboarding.start", { tenantId: "t", workspaceId: "w" })).rejects.toThrow("missing required field: authToken");
  });

  it("rejects missing tenantId", async () => {
    const ipc = makeIpc();
    const container = makeContainer();
    registerOnboarding(ipc, container, makeCollector());
    await expect(ipc._invoke("onboarding.start", { authToken: "a", workspaceId: "w" })).rejects.toThrow("missing required field: tenantId");
  });

  it("rejects missing workspaceId", async () => {
    const ipc = makeIpc();
    const container = makeContainer();
    registerOnboarding(ipc, container, makeCollector());
    await expect(ipc._invoke("onboarding.start", { authToken: "a", tenantId: "t" })).rejects.toThrow("missing required field: workspaceId");
  });
});

// ---------------------------------------------------------------------------
// registerAllMethods wiring
// ---------------------------------------------------------------------------

describe("registerAllMethods", () => {
  it("registers health.check, usage.query, usage.summary, onboarding.start", async () => {
    const ipc = makeIpc();
    const services = createServices(makeStubServiceDeps());
    registerAllMethods(ipc, services, 1000, vi.fn().mockReturnValue(2000));

    const health = await ipc._invoke("health.check", undefined) as { ok: boolean };
    expect(health.ok).toBe(true);

    const query = await ipc._invoke("usage.query", {});
    expect(Array.isArray(query)).toBe(true);

    const summary = await ipc._invoke("usage.summary", { days: 7 }) as { totalToolCalls: number };
    expect(typeof summary.totalToolCalls).toBe("number");

    const onboarding = await ipc._invoke("onboarding.start", { authToken: "t", tenantId: "t", workspaceId: "w" }) as OnboardingResult;
    expect(typeof onboarding.success).toBe("boolean");
  });
});
