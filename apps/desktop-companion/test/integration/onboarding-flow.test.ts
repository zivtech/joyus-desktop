/**
 * T064 — Onboarding flow integration test.
 *
 * Verifies the complete onboarding flow: mock auth, call onboarding.start,
 * verify MCP servers registered, skills synced, onboarding_complete flag set,
 * and partial failure resilience.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createServices,
  registerOnboarding,
  registerAllMethods,
  type ServiceDeps,
  type OnboardingParams,
  type OnboardingResult,
} from "../../src/sidecar/services";
import {
  createIpcHandler,
  type IpcHandler,
  type MethodHandler,
} from "../../src/sidecar/ipc-handler";
import { createUsageCollector } from "../../src/sidecar/usage-collector";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type InvokableMockIpc = IpcHandler & {
  notifications: Array<{ method: string; params: unknown }>;
  _invoke: (method: string, params: unknown) => Promise<unknown>;
};

function makeInvokableMockIpc(): InvokableMockIpc {
  const methods = new Map<string, MethodHandler>();
  const notifications: Array<{ method: string; params: unknown }> = [];

  return {
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
      if (!h) throw new Error(`Method not registered: ${method}`);
      return h(params);
    },
  } as unknown as InvokableMockIpc;
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
      startAll: vi.fn().mockReturnValue([
        { name: "atlassian-mcp", config: { command: "node", args: [] }, status: "running", enabled: true, restartCount: 0 },
        { name: "github-mcp", config: { command: "node", args: [] }, status: "running", enabled: true, restartCount: 0 },
      ]) as never,
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
    ...overrides,
  };
}

function makeCollector(ipc: IpcHandler) {
  return createUsageCollector(ipc, {
    nowFn: vi.fn().mockReturnValue(new Date().toISOString()),
    pruneAfterDays: 30,
  });
}

const VALID_PARAMS: OnboardingParams = {
  authToken: "tok-abc-123",
  tenantId: "tenant-acme",
  workspaceId: "ws-prod-01",
};

// ---------------------------------------------------------------------------
// T064: Happy path
// ---------------------------------------------------------------------------

describe("onboarding flow — happy path", () => {
  let ipc: InvokableMockIpc;

  beforeEach(() => {
    ipc = makeInvokableMockIpc();
  });

  it("returns success=true with serversStarted and skillsSynced", async () => {
    const container = createServices(makeStubServiceDeps());
    registerOnboarding(ipc, container, makeCollector(ipc));

    const result = await ipc._invoke("onboarding.start", VALID_PARAMS) as OnboardingResult;

    expect(result.success).toBe(true);
    expect(result.serversStarted).toBe(2);
    expect(result.skillsSynced).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("sends config.set notification for auth credentials", async () => {
    const container = createServices(makeStubServiceDeps());
    registerOnboarding(ipc, container, makeCollector(ipc));

    await ipc._invoke("onboarding.start", VALID_PARAMS);

    const authNotif = ipc.notifications.find(
      (n) => n.method === "config.set" && (n.params as { key: string }).key === "auth"
    );
    expect(authNotif).toBeDefined();

    const value = JSON.parse((authNotif!.params as { value: string }).value) as {
      authToken: string;
      tenantId: string;
      workspaceId: string;
    };
    expect(value.authToken).toBe("tok-abc-123");
    expect(value.tenantId).toBe("tenant-acme");
    expect(value.workspaceId).toBe("ws-prod-01");
  });

  it("sets onboarding_complete flag via config.set notification", async () => {
    const container = createServices(makeStubServiceDeps());
    registerOnboarding(ipc, container, makeCollector(ipc));

    await ipc._invoke("onboarding.start", VALID_PARAMS);

    const completeFlagNotif = ipc.notifications.find(
      (n) =>
        n.method === "config.set" &&
        (n.params as { key: string }).key === "onboarding_complete"
    );
    expect(completeFlagNotif).toBeDefined();
    expect((completeFlagNotif!.params as { value: string }).value).toBe("true");
  });

  it("verifies MCP servers registered: startAll called on registry", async () => {
    const startAll = vi.fn().mockReturnValue([
      { name: "atlassian-mcp", config: { command: "node", args: [] }, status: "running", enabled: true, restartCount: 0 },
    ]);
    const container = createServices(
      makeStubServiceDeps({
        createRegistry: () => ({
          registerServer: vi.fn() as never,
          unregisterServer: vi.fn() as never,
          startServer: vi.fn() as never,
          stopServer: vi.fn() as never,
          restartServer: vi.fn() as never,
          getStatus: vi.fn() as never,
          listServers: vi.fn().mockReturnValue([]) as never,
          startAll: startAll as never,
          stopAll: vi.fn() as never,
        }),
      })
    );
    registerOnboarding(ipc, container, makeCollector(ipc));

    const result = await ipc._invoke("onboarding.start", VALID_PARAMS) as OnboardingResult;

    expect(startAll).toHaveBeenCalledOnce();
    expect(result.serversStarted).toBe(1);
  });

  it("verifies skills synced: periodicSync.start called", async () => {
    const syncStart = vi.fn();
    const container = createServices(
      makeStubServiceDeps({
        createPeriodicSync: () => ({
          start: syncStart as never,
          stop: vi.fn() as never,
          getStatus: vi.fn().mockReturnValue("idle" as const) as never,
        }),
      })
    );
    registerOnboarding(ipc, container, makeCollector(ipc));

    const result = await ipc._invoke("onboarding.start", VALID_PARAMS) as OnboardingResult;

    expect(syncStart).toHaveBeenCalledOnce();
    expect(result.skillsSynced).toBe(true);
  });

  it("is accessible through registerAllMethods wiring", async () => {
    const realIpc = createIpcHandler(vi.fn());
    const container = createServices(makeStubServiceDeps());

    registerAllMethods(realIpc, container, 0, () => 100);

    const raw = JSON.stringify({ jsonrpc: "2.0", method: "onboarding.start", params: VALID_PARAMS, id: 99 });
    const resp = JSON.parse(await realIpc.handleRequest(raw)) as { result: OnboardingResult };

    expect(typeof resp.result.success).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// T064: Partial failure resilience
// ---------------------------------------------------------------------------

describe("onboarding flow — partial failure", () => {
  let ipc: InvokableMockIpc;

  beforeEach(() => {
    ipc = makeInvokableMockIpc();
  });

  it("server start failure: other steps still complete", async () => {
    const container = createServices(
      makeStubServiceDeps({
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
      })
    );
    registerOnboarding(ipc, container, makeCollector(ipc));

    const result = await ipc._invoke("onboarding.start", VALID_PARAMS) as OnboardingResult;

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("servers"))).toBe(true);
    // skills sync still completes
    expect(result.skillsSynced).toBe(true);
    // onboarding_complete still emitted
    const completeFlag = ipc.notifications.find(
      (n) => n.method === "config.set" && (n.params as { key: string }).key === "onboarding_complete"
    );
    expect(completeFlag).toBeDefined();
  });

  it("skill sync failure: server step still completes", async () => {
    const container = createServices(
      makeStubServiceDeps({
        createPeriodicSync: () => ({
          start: vi.fn().mockImplementation(() => { throw new Error("network unreachable"); }) as never,
          stop: vi.fn() as never,
          getStatus: vi.fn().mockReturnValue("idle" as const) as never,
        }),
      })
    );
    registerOnboarding(ipc, container, makeCollector(ipc));

    const result = await ipc._invoke("onboarding.start", VALID_PARAMS) as OnboardingResult;

    expect(result.success).toBe(false);
    expect(result.skillsSynced).toBe(false);
    expect(result.errors.some((e) => e.includes("sync"))).toBe(true);
    expect(result.serversStarted).toBe(2);
  });

  it("partial success: reports correct error list and counts", async () => {
    // Both servers and sync fail — auth succeeds
    const container = createServices(
      makeStubServiceDeps({
        createRegistry: () => ({
          registerServer: vi.fn() as never,
          unregisterServer: vi.fn() as never,
          startServer: vi.fn() as never,
          stopServer: vi.fn() as never,
          restartServer: vi.fn() as never,
          getStatus: vi.fn() as never,
          listServers: vi.fn().mockReturnValue([]) as never,
          startAll: vi.fn().mockImplementation(() => { throw new Error("db unavailable"); }) as never,
          stopAll: vi.fn() as never,
        }),
        createPeriodicSync: () => ({
          start: vi.fn().mockImplementation(() => { throw new Error("cdn unavailable"); }) as never,
          stop: vi.fn() as never,
          getStatus: vi.fn().mockReturnValue("idle" as const) as never,
        }),
      })
    );
    registerOnboarding(ipc, container, makeCollector(ipc));

    const result = await ipc._invoke("onboarding.start", VALID_PARAMS) as OnboardingResult;

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.serversStarted).toBe(0);
    expect(result.skillsSynced).toBe(false);
  });
});
