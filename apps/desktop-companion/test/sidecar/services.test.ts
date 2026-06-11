import { describe, expect, it, vi } from "vitest";
import { createServices, registerHealthCheck } from "../../src/sidecar/services";
import type { ServiceDeps } from "../../src/sidecar/services";
import type { IpcHandler } from "../../src/sidecar/ipc-handler";

function makeStubDeps(): ServiceDeps {
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
      startAll: vi.fn() as never,
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
  };
}

describe("createServices", () => {
  it("returns all service instances", () => {
    const deps = makeStubDeps();
    const container = createServices(deps);

    expect(container.processManager).toBeDefined();
    expect(container.registry).toBeDefined();
    expect(container.configPoller).toBeDefined();
    expect(container.periodicSync).toBeDefined();
  });

  it("passes processManager to createRegistry", () => {
    const deps = makeStubDeps();
    const spyCreateRegistry = vi.fn(deps.createRegistry);
    deps.createRegistry = spyCreateRegistry;

    const container = createServices(deps);

    expect(spyCreateRegistry).toHaveBeenCalledWith(container.processManager);
  });
});

describe("registerHealthCheck", () => {
  it("registers health.check that returns ok with uptime", async () => {
    let registeredHandler: ((params: unknown) => Promise<unknown>) | undefined;

    const mockIpc: IpcHandler = {
      handleRequest: vi.fn() as never,
      registerMethod: vi.fn((name: string, handler: (params: unknown) => Promise<unknown>) => {
        if (name === "health.check") {
          registeredHandler = handler;
        }
      }),
      sendNotification: vi.fn() as never,
    };

    const startTime = 1000;
    const nowFn = vi.fn().mockReturnValue(1500);

    registerHealthCheck(mockIpc, startTime, nowFn);

    expect(mockIpc.registerMethod).toHaveBeenCalledWith(
      "health.check",
      expect.any(Function),
    );

    expect(registeredHandler).toBeDefined();
    const result = await registeredHandler!(undefined);

    expect(result).toEqual({ ok: true, uptime_ms: 500 });
  });

  it("computes uptime dynamically based on nowFn", async () => {
    let registeredHandler: ((params: unknown) => Promise<unknown>) | undefined;

    const mockIpc: IpcHandler = {
      handleRequest: vi.fn() as never,
      registerMethod: vi.fn((_name: string, handler: (params: unknown) => Promise<unknown>) => {
        registeredHandler = handler;
      }),
      sendNotification: vi.fn() as never,
    };

    let currentTime = 2000;
    const nowFn = vi.fn(() => currentTime);

    registerHealthCheck(mockIpc, 1000, nowFn);

    const result1 = await registeredHandler!(undefined);
    expect(result1).toEqual({ ok: true, uptime_ms: 1000 });

    currentTime = 5000;
    const result2 = await registeredHandler!(undefined);
    expect(result2).toEqual({ ok: true, uptime_ms: 4000 });
  });
});
