import { describe, expect, it, vi } from "vitest";
import {
  registerServerMethods,
  registerServerNotifications,
  registerChromeDetect,
} from "../../src/sidecar/services";
import type { IpcHandler } from "../../src/sidecar/ipc-handler";
import type { Registry } from "@joyus/mcp-registry";
import type { ProcessManager } from "@joyus/mcp-registry";
import type { McpServerInfo } from "@joyus/mcp-registry";
import type { ChromeDetectDeps } from "../../src/sidecar/chrome-detect";
import { createDefaultChromeDeps } from "../../src/sidecar/chrome-detect";

// ---------- helpers ----------

function makeServerInfo(overrides: Partial<McpServerInfo> = {}): McpServerInfo {
  return {
    name: "test-server",
    config: { command: "node", args: ["server.js"] },
    status: "stopped",
    enabled: true,
    restartCount: 0,
    ...overrides,
  };
}

type MethodMap = Map<string, (params: unknown) => Promise<unknown>>;

function makeMockIpc(): { ipc: IpcHandler; methods: MethodMap; notifications: Array<{ method: string; params: unknown }> } {
  const methods: MethodMap = new Map();
  const notifications: Array<{ method: string; params: unknown }> = [];

  const ipc: IpcHandler = {
    handleRequest: vi.fn() as never,
    registerMethod: vi.fn((name: string, handler: (params: unknown) => Promise<unknown>) => {
      methods.set(name, handler);
    }),
    sendNotification: vi.fn((method: string, params: unknown) => {
      notifications.push({ method, params });
    }),
  };

  return { ipc, methods, notifications };
}

function makeRegistry(overrides: Partial<Registry> = {}): Registry {
  return {
    registerServer: vi.fn() as never,
    unregisterServer: vi.fn() as never,
    startServer: vi.fn().mockReturnValue(makeServerInfo({ status: "running" })) as never,
    stopServer: vi.fn().mockResolvedValue(makeServerInfo({ status: "stopped" })) as never,
    restartServer: vi.fn().mockResolvedValue(makeServerInfo({ status: "running" })) as never,
    getStatus: vi.fn().mockReturnValue("stopped") as never,
    listServers: vi.fn().mockReturnValue([makeServerInfo()]) as never,
    startAll: vi.fn() as never,
    stopAll: vi.fn() as never,
    ...overrides,
  };
}

function makeProcessManager(overrides: Partial<ProcessManager> = {}): ProcessManager {
  return {
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
    ...overrides,
  };
}

// ---------- servers.list ----------

describe("servers.list", () => {
  it("returns all servers from registry", async () => {
    const info = makeServerInfo({ name: "axe-core", status: "running" });
    const registry = makeRegistry({ listServers: vi.fn().mockReturnValue([info]) as never });
    const { ipc, methods } = makeMockIpc();

    registerServerMethods(ipc, registry);

    const handler = methods.get("servers.list")!;
    const result = await handler(undefined);

    expect(result).toEqual([info]);
  });

  it("returns empty array when no servers registered", async () => {
    const registry = makeRegistry({ listServers: vi.fn().mockReturnValue([]) as never });
    const { ipc, methods } = makeMockIpc();

    registerServerMethods(ipc, registry);

    const result = await methods.get("servers.list")!(undefined);
    expect(result).toEqual([]);
  });
});

// ---------- servers.start ----------

describe("servers.start", () => {
  it("starts a server and returns ServerInfo", async () => {
    const info = makeServerInfo({ status: "running" });
    const registry = makeRegistry({ startServer: vi.fn().mockReturnValue(info) as never });
    const { ipc, methods } = makeMockIpc();

    registerServerMethods(ipc, registry);

    const result = await methods.get("servers.start")!({ name: "test-server" });

    expect(registry.startServer).toHaveBeenCalledWith("test-server");
    expect(result).toEqual(info);
  });

  it("throws INVALID_PARAMS when name is missing", async () => {
    const { ipc, methods } = makeMockIpc();
    registerServerMethods(ipc, makeRegistry());

    await expect(methods.get("servers.start")!({})).rejects.toThrow("Missing required param: name");
  });

  it("throws INVALID_PARAMS when name is empty string", async () => {
    const { ipc, methods } = makeMockIpc();
    registerServerMethods(ipc, makeRegistry());

    await expect(methods.get("servers.start")!({ name: "" })).rejects.toThrow("Missing required param: name");
  });

  it("throws INVALID_PARAMS when params is not an object", async () => {
    const { ipc, methods } = makeMockIpc();
    registerServerMethods(ipc, makeRegistry());

    await expect(methods.get("servers.start")!(null)).rejects.toThrow("Missing required param: name");
  });

  it("propagates registry errors for unknown server", async () => {
    const registry = makeRegistry({
      startServer: vi.fn().mockImplementation(() => { throw new Error('Server "unknown" is not registered'); }) as never,
    });
    const { ipc, methods } = makeMockIpc();
    registerServerMethods(ipc, registry);

    await expect(methods.get("servers.start")!({ name: "unknown" })).rejects.toThrow("not registered");
  });
});

// ---------- servers.stop ----------

describe("servers.stop", () => {
  it("stops a server and returns { stopped: true }", async () => {
    const registry = makeRegistry();
    const { ipc, methods } = makeMockIpc();

    registerServerMethods(ipc, registry);

    const result = await methods.get("servers.stop")!({ name: "test-server" });

    expect(registry.stopServer).toHaveBeenCalledWith("test-server");
    expect(result).toEqual({ stopped: true });
  });

  it("throws INVALID_PARAMS when name is missing", async () => {
    const { ipc, methods } = makeMockIpc();
    registerServerMethods(ipc, makeRegistry());

    await expect(methods.get("servers.stop")!({})).rejects.toThrow("Missing required param: name");
  });

  it("throws INVALID_PARAMS when params is null", async () => {
    const { ipc, methods } = makeMockIpc();
    registerServerMethods(ipc, makeRegistry());

    await expect(methods.get("servers.stop")!(null)).rejects.toThrow("Missing required param: name");
  });

  it("propagates registry errors for unknown server", async () => {
    const registry = makeRegistry({
      stopServer: vi.fn().mockRejectedValue(new Error('Server "unknown" is not registered')) as never,
    });
    const { ipc, methods } = makeMockIpc();
    registerServerMethods(ipc, registry);

    await expect(methods.get("servers.stop")!({ name: "unknown" })).rejects.toThrow("not registered");
  });
});

// ---------- servers.restart ----------

describe("servers.restart", () => {
  it("restarts a server and returns ServerInfo", async () => {
    const info = makeServerInfo({ status: "running" });
    const registry = makeRegistry({ restartServer: vi.fn().mockResolvedValue(info) as never });
    const { ipc, methods } = makeMockIpc();

    registerServerMethods(ipc, registry);

    const result = await methods.get("servers.restart")!({ name: "test-server" });

    expect(registry.restartServer).toHaveBeenCalledWith("test-server");
    expect(result).toEqual(info);
  });

  it("throws INVALID_PARAMS when name is missing", async () => {
    const { ipc, methods } = makeMockIpc();
    registerServerMethods(ipc, makeRegistry());

    await expect(methods.get("servers.restart")!({})).rejects.toThrow("Missing required param: name");
  });

  it("throws INVALID_PARAMS when name is not a string", async () => {
    const { ipc, methods } = makeMockIpc();
    registerServerMethods(ipc, makeRegistry());

    await expect(methods.get("servers.restart")!({ name: 42 })).rejects.toThrow("Missing required param: name");
  });

  it("propagates registry errors for unknown server", async () => {
    const registry = makeRegistry({
      restartServer: vi.fn().mockRejectedValue(new Error('Server "unknown" is not registered')) as never,
    });
    const { ipc, methods } = makeMockIpc();
    registerServerMethods(ipc, registry);

    await expect(methods.get("servers.restart")!({ name: "unknown" })).rejects.toThrow("not registered");
  });
});

// ---------- state.serverChanged notifications ----------

describe("registerServerNotifications", () => {
  it("calls startWatchdog with correct interval and maxRestarts", () => {
    const pm = makeProcessManager();
    const registry = makeRegistry();
    const { ipc } = makeMockIpc();

    registerServerNotifications(ipc, pm, registry);

    expect(pm.startWatchdog).toHaveBeenCalledWith(5_000, 5, expect.any(Function));
  });

  it("emits state.serverChanged with server info when server is found in registry after restart", () => {
    let capturedOnRestart: ((name: string) => void) | undefined;
    const pm = makeProcessManager({
      startWatchdog: vi.fn((_interval, _max, cb) => { capturedOnRestart = cb; }) as never,
    });
    const info = makeServerInfo({ name: "axe-core", status: "running", restartCount: 1 });
    const registry = makeRegistry({
      listServers: vi.fn().mockReturnValue([info]) as never,
    });
    const { ipc, notifications } = makeMockIpc();

    registerServerNotifications(ipc, pm, registry);
    capturedOnRestart!("axe-core");

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toEqual({
      method: "state.serverChanged",
      params: { name: "axe-core", status: "running", restartCount: 1 },
    });
  });

  it("includes lastError in notification when server has error", () => {
    let capturedOnRestart: ((name: string) => void) | undefined;
    const pm = makeProcessManager({
      startWatchdog: vi.fn((_interval, _max, cb) => { capturedOnRestart = cb; }) as never,
    });
    const info = makeServerInfo({ name: "axe-core", status: "error", lastError: "exit code 1", restartCount: 2 });
    const registry = makeRegistry({
      listServers: vi.fn().mockReturnValue([info]) as never,
    });
    const { ipc, notifications } = makeMockIpc();

    registerServerNotifications(ipc, pm, registry);
    capturedOnRestart!("axe-core");

    expect(notifications[0]).toEqual({
      method: "state.serverChanged",
      params: { name: "axe-core", status: "error", lastError: "exit code 1", restartCount: 2 },
    });
  });

  it("emits error notification with max restarts exceeded when server not found in registry", () => {
    let capturedOnRestart: ((name: string) => void) | undefined;
    const pm = makeProcessManager({
      startWatchdog: vi.fn((_interval, _max, cb) => { capturedOnRestart = cb; }) as never,
    });
    const registry = makeRegistry({
      listServers: vi.fn().mockReturnValue([]) as never,
    });
    const { ipc, notifications } = makeMockIpc();

    registerServerNotifications(ipc, pm, registry);
    capturedOnRestart!("dead-server");

    expect(notifications[0]).toEqual({
      method: "state.serverChanged",
      params: { name: "dead-server", status: "error", lastError: "Max restarts exceeded", restartCount: 5 },
    });
  });

  it("handles registry.listServers throwing and emits error notification", () => {
    let capturedOnRestart: ((name: string) => void) | undefined;
    const pm = makeProcessManager({
      startWatchdog: vi.fn((_interval, _max, cb) => { capturedOnRestart = cb; }) as never,
    });
    const registry = makeRegistry({
      listServers: vi.fn().mockImplementation(() => { throw new Error("registry error"); }) as never,
    });
    const { ipc, notifications } = makeMockIpc();

    registerServerNotifications(ipc, pm, registry);
    capturedOnRestart!("broken-server");

    expect(notifications[0]).toEqual({
      method: "state.serverChanged",
      params: { name: "broken-server", status: "error", lastError: "Max restarts exceeded", restartCount: 5 },
    });
  });
});

// ---------- chrome.detect ----------

describe("registerChromeDetect", () => {
  it("returns available: true when Chrome is found", async () => {
    const chromeDeps: ChromeDetectDeps = {
      platform: "darwin",
      fileExists: vi.fn().mockReturnValue(true),
      execCommand: vi.fn().mockReturnValue("Google Chrome 120.0.6099.109"),
    };
    const { ipc, methods } = makeMockIpc();

    registerChromeDetect(ipc, chromeDeps);

    const result = await methods.get("chrome.detect")!(undefined) as Record<string, unknown>;
    expect(result["available"]).toBe(true);
    expect(result["path"]).toBe("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    expect(result["version"]).toBe("120.0.6099.109");
  });

  it("returns available: false when Chrome is not found", async () => {
    const chromeDeps: ChromeDetectDeps = {
      platform: "darwin",
      fileExists: vi.fn().mockReturnValue(false),
      execCommand: vi.fn() as never,
    };
    const { ipc, methods } = makeMockIpc();

    registerChromeDetect(ipc, chromeDeps);

    const result = await methods.get("chrome.detect")!(undefined) as Record<string, unknown>;
    expect(result["available"]).toBe(false);
    expect(result["path"]).toBeUndefined();
    expect(result["version"]).toBeUndefined();
  });

  it("returns available: true without version when exec fails", async () => {
    const chromeDeps: ChromeDetectDeps = {
      platform: "linux",
      fileExists: vi.fn().mockImplementation((p: string) => p === "/usr/bin/google-chrome"),
      execCommand: vi.fn().mockImplementation(() => { throw new Error("spawn error"); }),
    };
    const { ipc, methods } = makeMockIpc();

    registerChromeDetect(ipc, chromeDeps);

    const result = await methods.get("chrome.detect")!(undefined) as Record<string, unknown>;
    expect(result["available"]).toBe(true);
    expect(result["path"]).toBe("/usr/bin/google-chrome");
    expect(result["version"]).toBeUndefined();
  });

  it("returns available: false on unknown platform", async () => {
    const chromeDeps: ChromeDetectDeps = {
      platform: "freebsd",
      fileExists: vi.fn().mockReturnValue(false),
      execCommand: vi.fn() as never,
    };
    const { ipc, methods } = makeMockIpc();

    registerChromeDetect(ipc, chromeDeps);

    const result = await methods.get("chrome.detect")!(undefined) as Record<string, unknown>;
    expect(result["available"]).toBe(false);
  });

  it("checks Windows paths on win32 platform", async () => {
    const chromeDeps: ChromeDetectDeps = {
      platform: "win32",
      fileExists: vi.fn().mockImplementation((p: string) =>
        p === "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
      ),
      execCommand: vi.fn().mockReturnValue("Google Chrome 120.0.0.0"),
    };
    const { ipc, methods } = makeMockIpc();

    registerChromeDetect(ipc, chromeDeps);

    const result = await methods.get("chrome.detect")!(undefined) as Record<string, unknown>;
    expect(result["available"]).toBe(true);
    expect(result["path"]).toBe("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
  });
});

// ---------- createDefaultChromeDeps ----------

describe("createDefaultChromeDeps", () => {
  it("returns an object with platform, fileExists, and execCommand", () => {
    const deps = createDefaultChromeDeps();
    expect(typeof deps.platform).toBe("string");
    expect(typeof deps.fileExists).toBe("function");
    expect(typeof deps.execCommand).toBe("function");
  });

  it("fileExists returns false for a non-existent path", () => {
    const deps = createDefaultChromeDeps();
    expect(deps.fileExists("/this/path/does/not/exist/at/all")).toBe(false);
  });

  it("execCommand returns string output for a valid command", () => {
    const deps = createDefaultChromeDeps();
    const result = deps.execCommand("echo hello");
    expect(typeof result).toBe("string");
  });
});
