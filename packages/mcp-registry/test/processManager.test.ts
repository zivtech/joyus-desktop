import { describe, expect, it, vi } from "vitest";
import { createProcessManager, type ChildHandle, type ProcessManagerDeps } from "../src/processManager";

function makeDeps(overrides?: Partial<ProcessManagerDeps>): ProcessManagerDeps {
  return {
    spawn: vi.fn((): ChildHandle => ({
      pid: 1000,
      kill: vi.fn(),
      on: vi.fn(),
    })),
    kill: vi.fn(() => true),
    readFile: vi.fn(async () => "[]"),
    writeFile: vi.fn(async () => undefined),
    processExists: vi.fn(() => true),
    setTimeout: vi.fn((cb: () => void, _ms: number) => {
      cb();
      return 1 as unknown as ReturnType<typeof globalThis.setTimeout>;
    }),
    clearTimeout: vi.fn(),
    setInterval: vi.fn((_cb: () => void, _ms: number) => {
      return 2 as unknown as ReturnType<typeof globalThis.setInterval>;
    }),
    clearInterval: vi.fn(),
    ...overrides,
  };
}

function makeChild(pid: number): ChildHandle {
  return {
    pid,
    kill: vi.fn(),
    on: vi.fn(),
  };
}

describe("createProcessManager", () => {
  describe("spawnServer", () => {
    it("spawns a process and returns pid", () => {
      const child = makeChild(2000);
      const deps = makeDeps({
        spawn: vi.fn(() => child),
      });
      const pm = createProcessManager(deps);

      const pid = pm.spawnServer("test-srv", { command: "node", args: ["srv.js"] });
      expect(pid).toBe(2000);
      expect(deps.spawn).toHaveBeenCalledWith("node", ["srv.js"], {
        env: undefined,
        stdio: "pipe",
        detached: true,
      });
    });

    it("passes env to spawn", () => {
      const child = makeChild(3000);
      const deps = makeDeps({
        spawn: vi.fn(() => child),
      });
      const pm = createProcessManager(deps);

      pm.spawnServer("srv", { command: "node", args: [], env: { FOO: "bar" } });
      expect(deps.spawn).toHaveBeenCalledWith("node", [], {
        env: { FOO: "bar" },
        stdio: "pipe",
        detached: true,
      });
    });

    it("throws if server is already running", () => {
      const child = makeChild(4000);
      const deps = makeDeps({
        spawn: vi.fn(() => child),
      });
      const pm = createProcessManager(deps);

      pm.spawnServer("dup", { command: "node", args: [] });
      expect(() => pm.spawnServer("dup", { command: "node", args: [] })).toThrow(
        'Server "dup" is already running',
      );
    });

    it("removes process on exit event", () => {
      let exitCb: ((code: number | null) => void) | undefined;
      const child: ChildHandle = {
        pid: 5000,
        kill: vi.fn(),
        on: vi.fn((event: string, cb: (code: number | null) => void) => {
          if (event === "exit") {
            exitCb = cb;
          }
        }),
      };
      const deps = makeDeps({ spawn: vi.fn(() => child) });
      const pm = createProcessManager(deps);

      pm.spawnServer("exiter", { command: "node", args: [] });
      expect(pm.isRunning("exiter")).toBe(true);

      exitCb?.(0);
      expect(pm.isRunning("exiter")).toBe(false);
    });

    it("exit event does not remove if child reference changed", () => {
      let firstExitCb: ((code: number | null) => void) | undefined;
      const child1: ChildHandle = {
        pid: 6000,
        kill: vi.fn(),
        on: vi.fn((event: string, cb: (code: number | null) => void) => {
          if (event === "exit") {
            firstExitCb = cb;
          }
        }),
      };
      const child2: ChildHandle = {
        pid: 7000,
        kill: vi.fn(),
        on: vi.fn(),
      };

      let callCount = 0;
      const deps = makeDeps({
        spawn: vi.fn(() => {
          callCount++;
          return callCount === 1 ? child1 : child2;
        }),
        processExists: vi.fn(() => false),
        // Make stopServer resolve immediately
        setTimeout: vi.fn((cb: () => void) => {
          cb();
          return 1 as unknown as ReturnType<typeof globalThis.setTimeout>;
        }),
        setInterval: vi.fn((cb: () => void) => {
          cb();
          return 2 as unknown as ReturnType<typeof globalThis.setInterval>;
        }),
      });

      const pm = createProcessManager(deps);
      pm.spawnServer("swap", { command: "node", args: [] });

      // Manually remove and re-add with different child
      // Simulate: stop completes, then re-spawn
      // We need to delete the old entry first
      // Use the exit callback from child1 after child2 is set
      // Actually let's just directly test the guard:
      // Force-remove the old entry and add new one, then fire old exit
      // The simplest way: stopServer will delete, then spawnServer adds child2
      // But stopServer is async. Let's just test the guard directly.

      // Manually delete and re-add to simulate the race
      // We'll call stopServer which deletes the entry, then spawnServer with child2
      void pm.stopServer("swap").then(() => {
        pm.spawnServer("swap", { command: "node", args: [] });
        // Now fire the old exit callback — should NOT remove the new entry
        firstExitCb?.(0);
        expect(pm.isRunning("swap")).toBe(true);
      });
    });
  });

  describe("stopServer", () => {
    it("returns false if server not running", async () => {
      const deps = makeDeps();
      const pm = createProcessManager(deps);

      const result = await pm.stopServer("nonexistent");
      expect(result).toBe(false);
    });

    it("sends SIGTERM and resolves when process exits", async () => {
      const child = makeChild(8000);
      const deps = makeDeps({
        spawn: vi.fn(() => child),
        processExists: vi.fn(() => false),
        setTimeout: vi.fn((cb: () => void) => {
          // Don't call immediately; let interval check resolve first
          return globalThis.setTimeout(cb, 10);
        }),
        clearTimeout: vi.fn((id) => globalThis.clearTimeout(id)),
        setInterval: vi.fn((cb: () => void) => {
          // Call check immediately
          cb();
          return 3 as unknown as ReturnType<typeof globalThis.setInterval>;
        }),
        clearInterval: vi.fn(),
      });

      const pm = createProcessManager(deps);
      pm.spawnServer("graceful", { command: "node", args: [] });

      const result = await pm.stopServer("graceful");
      expect(result).toBe(true);
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      // SIGKILL should NOT have been called since process exited gracefully
      expect(deps.kill).not.toHaveBeenCalledWith(8000, "SIGKILL");
    });

    it("sends SIGKILL after timeout", async () => {
      const child = makeChild(9000);
      const deps = makeDeps({
        spawn: vi.fn(() => child),
        processExists: vi.fn(() => true), // Process never exits
        setTimeout: vi.fn((cb: () => void) => {
          cb(); // Timeout fires immediately
          return 1 as unknown as ReturnType<typeof globalThis.setTimeout>;
        }),
        clearTimeout: vi.fn(),
        setInterval: vi.fn(() => {
          // Don't call the interval callback — process stays alive
          return 2 as unknown as ReturnType<typeof globalThis.setInterval>;
        }),
        clearInterval: vi.fn(),
      });

      const pm = createProcessManager(deps);
      pm.spawnServer("stubborn", { command: "node", args: [] });

      const result = await pm.stopServer("stubborn");
      expect(result).toBe(true);
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      expect(deps.kill).toHaveBeenCalledWith(9000, "SIGKILL");
    });
  });

  describe("stopAll", () => {
    it("stops all running servers", async () => {
      let pidCounter = 100;
      const deps = makeDeps({
        spawn: vi.fn(() => makeChild(pidCounter++)),
        processExists: vi.fn(() => false),
        setTimeout: vi.fn((cb: () => void) => {
          return globalThis.setTimeout(cb, 10);
        }),
        clearTimeout: vi.fn((id) => globalThis.clearTimeout(id)),
        setInterval: vi.fn((cb: () => void) => {
          cb();
          return 3 as unknown as ReturnType<typeof globalThis.setInterval>;
        }),
        clearInterval: vi.fn(),
      });

      const pm = createProcessManager(deps);
      pm.spawnServer("a", { command: "node", args: [] });
      pm.spawnServer("b", { command: "node", args: [] });

      await pm.stopAll();
      expect(pm.isRunning("a")).toBe(false);
      expect(pm.isRunning("b")).toBe(false);
    });
  });

  describe("isRunning / getEntry", () => {
    it("isRunning returns false for unknown server", () => {
      const pm = createProcessManager(makeDeps());
      expect(pm.isRunning("nope")).toBe(false);
    });

    it("getEntry returns undefined for unknown server", () => {
      const pm = createProcessManager(makeDeps());
      expect(pm.getEntry("nope")).toBeUndefined();
    });

    it("getEntry returns entry for running server", () => {
      const child = makeChild(1111);
      const deps = makeDeps({ spawn: vi.fn(() => child) });
      const pm = createProcessManager(deps);

      pm.spawnServer("info", { command: "node", args: [] });
      const entry = pm.getEntry("info");
      expect(entry?.child.pid).toBe(1111);
      expect(entry?.name).toBe("info");
      expect(entry?.restartCount).toBe(0);
    });
  });

  describe("PID file operations", () => {
    it("writePidFile writes JSON", async () => {
      const deps = makeDeps();
      const pm = createProcessManager(deps);

      const entries = [{ name: "a", pid: 10, startedAt: "2026-01-01T00:00:00Z" }];
      await pm.writePidFile(entries, "/tmp/pids.json");

      expect(deps.writeFile).toHaveBeenCalledWith(
        "/tmp/pids.json",
        JSON.stringify(entries, null, 2),
      );
    });

    it("readPidFile reads and parses JSON", async () => {
      const entries = [{ name: "b", pid: 20, startedAt: "2026-01-01T00:00:00Z" }];
      const deps = makeDeps({
        readFile: vi.fn(async () => JSON.stringify(entries)),
      });
      const pm = createProcessManager(deps);

      const result = await pm.readPidFile("/tmp/pids.json");
      expect(result).toEqual(entries);
    });

    it("readPidFile returns empty array on error", async () => {
      const deps = makeDeps({
        readFile: vi.fn(async () => {
          throw new Error("ENOENT");
        }),
      });
      const pm = createProcessManager(deps);

      const result = await pm.readPidFile("/tmp/missing.json");
      expect(result).toEqual([]);
    });
  });

  describe("cleanupOrphans", () => {
    it("kills running orphan processes and clears PID file", async () => {
      const entries = [
        { name: "orphan1", pid: 111, startedAt: "2026-01-01T00:00:00Z" },
        { name: "orphan2", pid: 222, startedAt: "2026-01-01T00:00:00Z" },
      ];
      const deps = makeDeps({
        readFile: vi.fn(async () => JSON.stringify(entries)),
        processExists: vi.fn(() => true),
      });
      const pm = createProcessManager(deps);

      const killed = await pm.cleanupOrphans("/tmp/pids.json");
      expect(killed).toBe(2);
      expect(deps.kill).toHaveBeenCalledWith(111, "SIGTERM");
      expect(deps.kill).toHaveBeenCalledWith(222, "SIGTERM");
      expect(deps.writeFile).toHaveBeenCalledWith("/tmp/pids.json", JSON.stringify([], null, 2));
    });

    it("skips non-running processes", async () => {
      const entries = [{ name: "dead", pid: 333, startedAt: "2026-01-01T00:00:00Z" }];
      const deps = makeDeps({
        readFile: vi.fn(async () => JSON.stringify(entries)),
        processExists: vi.fn(() => false),
      });
      const pm = createProcessManager(deps);

      const killed = await pm.cleanupOrphans("/tmp/pids.json");
      expect(killed).toBe(0);
      // Still clears the PID file
      expect(deps.writeFile).toHaveBeenCalled();
    });

    it("handles empty PID file without writing", async () => {
      const deps = makeDeps({
        readFile: vi.fn(async () => "[]"),
      });
      const pm = createProcessManager(deps);

      const killed = await pm.cleanupOrphans("/tmp/pids.json");
      expect(killed).toBe(0);
      expect(deps.writeFile).not.toHaveBeenCalled();
    });
  });

  describe("watchdog", () => {
    it("starts and invokes onRestart for dead processes", () => {
      let intervalCb: (() => void) | undefined;
      const deps = makeDeps({
        spawn: vi.fn(() => makeChild(500)),
        processExists: vi.fn(() => false),
        setInterval: vi.fn((cb: () => void) => {
          intervalCb = cb;
          return 10 as unknown as ReturnType<typeof globalThis.setInterval>;
        }),
        clearInterval: vi.fn(),
      });

      const pm = createProcessManager(deps);
      pm.spawnServer("watched", { command: "node", args: [] });

      const onRestart = vi.fn();
      pm.startWatchdog(1000, 3, onRestart);

      // Simulate watchdog tick
      intervalCb?.();

      expect(onRestart).toHaveBeenCalledWith("watched", { command: "", args: [] });
      expect(pm.isRunning("watched")).toBe(false);
    });

    it("stops restarting after max restarts", () => {
      let intervalCb: (() => void) | undefined;
      const child = makeChild(600);
      const deps = makeDeps({
        spawn: vi.fn(() => child),
        processExists: vi.fn(() => false),
        setInterval: vi.fn((cb: () => void) => {
          intervalCb = cb;
          return 10 as unknown as ReturnType<typeof globalThis.setInterval>;
        }),
        clearInterval: vi.fn(),
      });

      const pm = createProcessManager(deps);
      pm.spawnServer("maxed", { command: "node", args: [] });

      // Manually set restartCount to max
      const entry = pm.getEntry("maxed");
      if (entry) {
        entry.restartCount = 3;
      }

      const onRestart = vi.fn();
      pm.startWatchdog(1000, 3, onRestart);

      intervalCb?.();

      expect(onRestart).not.toHaveBeenCalled();
      expect(pm.isRunning("maxed")).toBe(false);
    });

    it("stopWatchdog clears the interval", () => {
      const deps = makeDeps({
        setInterval: vi.fn(() => 99 as unknown as ReturnType<typeof globalThis.setInterval>),
      });
      const pm = createProcessManager(deps);

      pm.startWatchdog(1000, 3, vi.fn());
      pm.stopWatchdog();

      expect(deps.clearInterval).toHaveBeenCalledWith(99);
    });

    it("stopWatchdog is safe to call when not started", () => {
      const deps = makeDeps();
      const pm = createProcessManager(deps);

      // Should not throw
      pm.stopWatchdog();
      expect(deps.clearInterval).not.toHaveBeenCalled();
    });

    it("startWatchdog replaces existing watchdog", () => {
      const deps = makeDeps({
        setInterval: vi.fn(() => 50 as unknown as ReturnType<typeof globalThis.setInterval>),
      });
      const pm = createProcessManager(deps);

      pm.startWatchdog(1000, 3, vi.fn());
      pm.startWatchdog(2000, 5, vi.fn());

      expect(deps.clearInterval).toHaveBeenCalledWith(50);
    });
  });
});
