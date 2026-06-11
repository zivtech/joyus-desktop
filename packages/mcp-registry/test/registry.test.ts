import { describe, expect, it, vi } from "vitest";
import type { ProcessEntry, ProcessManager } from "../src/processManager";
import { createRegistry } from "../src/registry";
import type { ServerManifest } from "../src/types";

function makeMockPM(overrides?: Partial<ProcessManager>): ProcessManager {
  return {
    spawnServer: vi.fn(() => 1000),
    stopServer: vi.fn(async () => true),
    stopAll: vi.fn(async () => undefined),
    isRunning: vi.fn(() => false),
    getEntry: vi.fn(() => undefined),
    writePidFile: vi.fn(async () => undefined),
    readPidFile: vi.fn(async () => []),
    cleanupOrphans: vi.fn(async () => 0),
    startWatchdog: vi.fn(),
    stopWatchdog: vi.fn(),
    ...overrides,
  };
}

const emptyManifest: ServerManifest = { servers: {} };

describe("createRegistry", () => {
  describe("initialization from manifest", () => {
    it("loads servers from manifest", () => {
      const manifest: ServerManifest = {
        servers: {
          foo: { command: "node", args: ["foo.js"], enabled: true, version: "1.0.0" },
          bar: { command: "python", args: ["bar.py"], enabled: false },
        },
      };
      const pm = makeMockPM();
      const registry = createRegistry(manifest, { processManager: pm });

      const servers = registry.listServers();
      expect(servers).toHaveLength(2);
      expect(servers[0]?.name).toBe("foo");
      expect(servers[0]?.version).toBe("1.0.0");
      expect(servers[0]?.enabled).toBe(true);
      expect(servers[1]?.name).toBe("bar");
      expect(servers[1]?.enabled).toBe(false);
      expect(servers[1]?.version).toBeUndefined();
    });
  });

  describe("registerServer", () => {
    it("registers a new server", () => {
      const pm = makeMockPM();
      const registry = createRegistry(emptyManifest, { processManager: pm });

      registry.registerServer("new-srv", { command: "node", args: ["s.js"], version: "2.0.0" });
      const servers = registry.listServers();
      expect(servers).toHaveLength(1);
      expect(servers[0]?.name).toBe("new-srv");
      expect(servers[0]?.version).toBe("2.0.0");
    });

    it("registers a server without version", () => {
      const pm = makeMockPM();
      const registry = createRegistry(emptyManifest, { processManager: pm });

      registry.registerServer("no-ver", { command: "node", args: [] });
      const servers = registry.listServers();
      expect(servers[0]?.version).toBeUndefined();
    });

    it("registers a server with env", () => {
      const pm = makeMockPM();
      const registry = createRegistry(emptyManifest, { processManager: pm });

      registry.registerServer("env-srv", {
        command: "node",
        args: [],
        env: { PORT: "8080" },
      });
      const servers = registry.listServers();
      expect(servers[0]?.config.env).toEqual({ PORT: "8080" });
    });

    it("throws if server already registered", () => {
      const pm = makeMockPM();
      const registry = createRegistry(emptyManifest, { processManager: pm });

      registry.registerServer("dup", { command: "node", args: [] });
      expect(() => registry.registerServer("dup", { command: "node", args: [] })).toThrow(
        'Server "dup" is already registered',
      );
    });
  });

  describe("unregisterServer", () => {
    it("removes a stopped server", () => {
      const pm = makeMockPM();
      const registry = createRegistry(emptyManifest, { processManager: pm });

      registry.registerServer("rem", { command: "node", args: [] });
      registry.unregisterServer("rem");
      expect(registry.listServers()).toHaveLength(0);
    });

    it("throws if server not registered", () => {
      const pm = makeMockPM();
      const registry = createRegistry(emptyManifest, { processManager: pm });

      expect(() => registry.unregisterServer("nope")).toThrow('Server "nope" is not registered');
    });

    it("throws if server is still running", () => {
      const pm = makeMockPM({ isRunning: vi.fn(() => true) });
      const registry = createRegistry(emptyManifest, { processManager: pm });

      registry.registerServer("active", { command: "node", args: [] });
      expect(() => registry.unregisterServer("active")).toThrow(
        'Server "active" is still running; stop it first',
      );
    });
  });

  describe("startServer", () => {
    it("starts a registered server", () => {
      const runningSet = new Set<string>();
      const pm = makeMockPM({
        spawnServer: vi.fn((name: string) => {
          runningSet.add(name);
          return 2000;
        }),
        isRunning: vi.fn((name: string) => runningSet.has(name)),
        getEntry: vi.fn((name: string): ProcessEntry | undefined =>
          runningSet.has(name) ? { child: { pid: 2000, kill: vi.fn(), on: vi.fn() }, name, restartCount: 0 } : undefined,
        ),
      });
      const registry = createRegistry(emptyManifest, { processManager: pm });

      registry.registerServer("starter", { command: "node", args: ["s.js"] });
      const info = registry.startServer("starter");
      expect(info.status).toBe("running");
      expect(info.pid).toBe(2000);
    });

    it("throws if server not registered", () => {
      const pm = makeMockPM();
      const registry = createRegistry(emptyManifest, { processManager: pm });

      expect(() => registry.startServer("ghost")).toThrow('Server "ghost" is not registered');
    });

    it("throws if server already running", () => {
      const pm = makeMockPM({ isRunning: vi.fn(() => true) });
      const registry = createRegistry(emptyManifest, { processManager: pm });

      registry.registerServer("running", { command: "node", args: [] });
      expect(() => registry.startServer("running")).toThrow(
        'Server "running" is already running',
      );
    });
  });

  describe("stopServer", () => {
    it("stops a registered server", async () => {
      const pm = makeMockPM();
      const registry = createRegistry(emptyManifest, { processManager: pm });

      registry.registerServer("stopper", { command: "node", args: [] });
      const info = await registry.stopServer("stopper");
      expect(info.status).toBe("stopped");
      expect(pm.stopServer).toHaveBeenCalledWith("stopper");
    });

    it("throws if server not registered", async () => {
      const pm = makeMockPM();
      const registry = createRegistry(emptyManifest, { processManager: pm });

      await expect(registry.stopServer("nope")).rejects.toThrow('Server "nope" is not registered');
    });
  });

  describe("restartServer", () => {
    it("restarts a running server", async () => {
      let running = true;
      const pm = makeMockPM({
        isRunning: vi.fn(() => running),
        stopServer: vi.fn(async () => {
          running = false;
          return true;
        }),
        spawnServer: vi.fn(() => {
          running = true;
          return 3000;
        }),
        getEntry: vi.fn((): ProcessEntry | undefined =>
          running ? { child: { pid: 3000, kill: vi.fn(), on: vi.fn() }, name: "restarter", restartCount: 0 } : undefined,
        ),
      });
      const registry = createRegistry(emptyManifest, { processManager: pm });

      registry.registerServer("restarter", { command: "node", args: [] });
      const info = await registry.restartServer("restarter");
      expect(info.status).toBe("running");
      expect(pm.stopServer).toHaveBeenCalledWith("restarter");
    });

    it("starts a stopped server on restart", async () => {
      let running = false;
      const pm = makeMockPM({
        isRunning: vi.fn(() => running),
        spawnServer: vi.fn(() => { running = true; return 4000; }),
        getEntry: vi.fn((): ProcessEntry | undefined =>
          running
            ? { child: { pid: 4000, kill: vi.fn(), on: vi.fn() }, name: "stopped-restart", restartCount: 0 }
            : undefined,
        ),
      });
      const registry = createRegistry(emptyManifest, { processManager: pm });

      registry.registerServer("stopped-restart", { command: "node", args: [] });
      const info = await registry.restartServer("stopped-restart");
      expect(info.status).toBe("running");
      expect(pm.stopServer).not.toHaveBeenCalled();
    });

    it("throws if server not registered", async () => {
      const pm = makeMockPM();
      const registry = createRegistry(emptyManifest, { processManager: pm });

      await expect(registry.restartServer("ghost")).rejects.toThrow(
        'Server "ghost" is not registered',
      );
    });
  });

  describe("getStatus", () => {
    it("returns stopped for idle server", () => {
      const pm = makeMockPM();
      const registry = createRegistry(emptyManifest, { processManager: pm });

      registry.registerServer("idle", { command: "node", args: [] });
      expect(registry.getStatus("idle")).toBe("stopped");
    });

    it("returns running for active server", () => {
      const pm = makeMockPM({
        isRunning: vi.fn(() => true),
        getEntry: vi.fn((): ProcessEntry => ({
          child: { pid: 5000, kill: vi.fn(), on: vi.fn() },
          name: "active",
          restartCount: 0,
        })),
      });
      const registry = createRegistry(emptyManifest, { processManager: pm });

      registry.registerServer("active", { command: "node", args: [] });
      expect(registry.getStatus("active")).toBe("running");
    });

    it("returns error when process has lastError", () => {
      const pm = makeMockPM({
        isRunning: vi.fn(() => true),
        getEntry: vi.fn((): ProcessEntry => ({
          child: { pid: 5000, kill: vi.fn(), on: vi.fn() },
          name: "errored",
          restartCount: 0,
          lastError: "crash",
        })),
      });
      const registry = createRegistry(emptyManifest, { processManager: pm });

      registry.registerServer("errored", { command: "node", args: [] });
      const status = registry.getStatus("errored");
      expect(status).toBe("error");
    });

    it("throws for unregistered server", () => {
      const pm = makeMockPM();
      const registry = createRegistry(emptyManifest, { processManager: pm });

      expect(() => registry.getStatus("unknown")).toThrow('Server "unknown" is not registered');
    });
  });

  describe("listServers", () => {
    it("returns info for all servers", () => {
      const pm = makeMockPM();
      const manifest: ServerManifest = {
        servers: {
          a: { command: "node", args: ["a.js"], enabled: true },
          b: { command: "node", args: ["b.js"], enabled: false },
        },
      };
      const registry = createRegistry(manifest, { processManager: pm });

      const list = registry.listServers();
      expect(list).toHaveLength(2);
      expect(list[0]?.name).toBe("a");
      expect(list[1]?.name).toBe("b");
    });
  });

  describe("startAll", () => {
    it("starts all enabled servers", () => {
      const started = new Set<string>();
      const pm = makeMockPM({
        spawnServer: vi.fn((name: string) => {
          started.add(name);
          return 6000;
        }),
        isRunning: vi.fn((name: string) => started.has(name)),
        getEntry: vi.fn((name: string): ProcessEntry | undefined =>
          started.has(name) ? { child: { pid: 6000, kill: vi.fn(), on: vi.fn() }, name, restartCount: 0 } : undefined,
        ),
      });
      const manifest: ServerManifest = {
        servers: {
          enabled: { command: "node", args: [], enabled: true },
          disabled: { command: "node", args: [], enabled: false },
        },
      };
      const registry = createRegistry(manifest, { processManager: pm });

      const results = registry.startAll();
      expect(results).toHaveLength(2);
      expect(pm.spawnServer).toHaveBeenCalledTimes(1);
      expect(started.has("enabled")).toBe(true);
      expect(started.has("disabled")).toBe(false);
    });

    it("skips already running servers", () => {
      const pm = makeMockPM({
        isRunning: vi.fn(() => true),
        getEntry: vi.fn((name: string): ProcessEntry => ({
          child: { pid: 7000, kill: vi.fn(), on: vi.fn() },
          name,
          restartCount: 0,
        })),
      });
      const manifest: ServerManifest = {
        servers: {
          running: { command: "node", args: [], enabled: true },
        },
      };
      const registry = createRegistry(manifest, { processManager: pm });

      registry.startAll();
      expect(pm.spawnServer).not.toHaveBeenCalled();
    });
  });

  describe("stopAll", () => {
    it("stops all servers via process manager", async () => {
      const pm = makeMockPM();
      const manifest: ServerManifest = {
        servers: {
          x: { command: "node", args: [], enabled: true },
        },
      };
      const registry = createRegistry(manifest, { processManager: pm });

      const results = await registry.stopAll();
      expect(pm.stopAll).toHaveBeenCalled();
      expect(results).toHaveLength(1);
      expect(results[0]?.status).toBe("stopped");
    });
  });
});
