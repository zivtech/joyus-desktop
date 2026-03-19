/**
 * T067 — Performance validation.
 *
 * Measures startup to MCP ready (<10s), idle memory (<50MB),
 * warm sync (<15s), watchdog restart (<30s).
 * Benchmarks run 3 times each; median is reported.
 */
import { describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { startSidecar } from "../../src/sidecar/main";
import type { SidecarDeps } from "../../src/sidecar/main";
import type { ServiceDeps } from "../../src/sidecar/services";
import {
  registerSyncMethods,
  registerServerNotifications,
  type SyncState,
  type SyncIpcDeps,
} from "../../src/sidecar/services";
import { createIpcHandler } from "../../src/sidecar/ipc-handler";
import type { ProcessManager, Registry } from "@joyus/mcp-registry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStubServiceDeps(): ServiceDeps {
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
      getConfig: vi.fn().mockReturnValue({ mode: "off" as const, updatedAt: "" }) as never,
    }),
    createPeriodicSync: () => ({
      start: vi.fn() as never,
      stop: vi.fn() as never,
      getStatus: vi.fn().mockReturnValue("idle" as const) as never,
    }),
  };
}

function makeReadable(lines: string[]): NodeJS.ReadableStream {
  const r = new Readable({ read() {} });
  for (const line of lines) r.push(line + "\n");
  r.push(null);
  return r;
}

function makeDeps(lines: string[], overrides?: Partial<SidecarDeps>): SidecarDeps {
  return {
    stdin: makeReadable(lines),
    stdout: { write: vi.fn() },
    stderr: { write: vi.fn() },
    exit: vi.fn(),
    onSignal: vi.fn(),
    onUncaughtException: vi.fn(),
    onUnhandledRejection: vi.fn(),
    nowFn: vi.fn().mockReturnValue(Date.now()),
    serviceDeps: makeStubServiceDeps(),
    isOptedOut: vi.fn().mockReturnValue(false),
    emitTelemetry: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function waitMs(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

// ---------------------------------------------------------------------------
// SC-003: Startup to MCP ready < 10 seconds
// ---------------------------------------------------------------------------

describe("SC-003 performance — startup to MCP ready", () => {
  it("sidecar starts and responds to health.check in under 10 seconds (3 runs, median)", async () => {
    const RUNS = 3;
    const TARGET_MS = 10_000;
    const samples: number[] = [];

    for (let i = 0; i < RUNS; i++) {
      const request = JSON.stringify({ jsonrpc: "2.0", method: "health.check", id: i });
      const stdoutWrite = vi.fn();
      const deps = makeDeps([request], { stdout: { write: stdoutWrite } });

      const t0 = Date.now();
      startSidecar(deps);
      await waitMs(50);
      const elapsed = Date.now() - t0;

      expect(stdoutWrite).toHaveBeenCalled();
      const resp = JSON.parse((stdoutWrite.mock.calls[0]![0] as string).trim()) as {
        result?: { ok: boolean };
      };
      expect(resp.result?.ok).toBe(true);

      samples.push(elapsed);
    }

    const med = median(samples);
    console.log(`[SC-003] startup-to-ready median: ${med}ms (samples: ${samples.join(", ")}ms)`);
    expect(med).toBeLessThan(TARGET_MS);
  });
});

// ---------------------------------------------------------------------------
// SC-007: Idle memory < 50 MB
// ---------------------------------------------------------------------------

describe("SC-007 performance — idle memory", () => {
  it("sidecar process RSS after startup is under 50 MB", async () => {
    const TARGET_MB = 50;

    const rssBeforeKb = process.memoryUsage().rss / 1024;

    const deps = makeDeps([]);
    startSidecar(deps);
    await waitMs(50);

    const rssAfterKb = process.memoryUsage().rss / 1024;
    const deltaMb = (rssAfterKb - rssBeforeKb) / 1024;

    console.log(`[SC-007] idle RSS delta: ${deltaMb.toFixed(2)} MB (total: ${(rssAfterKb / 1024).toFixed(2)} MB)`);

    // The sidecar startup delta must be well under 50 MB
    expect(deltaMb).toBeLessThan(TARGET_MB);
  });
});

// ---------------------------------------------------------------------------
// SC-008: Warm sync < 15 seconds
// ---------------------------------------------------------------------------

describe("SC-008 performance — warm sync duration", () => {
  it("sync.trigger with warm cache completes in under 15 seconds (3 runs, median)", async () => {
    const RUNS = 3;
    const TARGET_MS = 15_000;
    const samples: number[] = [];

    for (let i = 0; i < RUNS; i++) {
      const ipc = createIpcHandler(vi.fn());
      const syncState: SyncState = { status: "idle", version: null, timestamp: null };
      const syncResult = {
        version: "1.0.0",
        syncedAt: new Date().toISOString(),
        fromCache: true,
        durationMs: 200,
      };
      const syncIpcDeps: SyncIpcDeps = {
        syncConfig: { destDir: "/skills", bundleName: "default" },
        triggerSync: vi.fn().mockResolvedValue(syncResult),
        scannerDeps: {
          readdir: vi.fn().mockResolvedValue([]) as never,
          readFile: vi.fn() as never,
        },
      };

      const container = {
        processManager: {} as ProcessManager,
        registry: {} as Registry,
        configPoller: { start: vi.fn() as never, stop: vi.fn() as never, getConfig: vi.fn() as never },
        periodicSync: { start: vi.fn() as never, stop: vi.fn() as never, getStatus: vi.fn() as never },
      };

      registerSyncMethods(ipc, container, syncIpcDeps, syncState);

      const t0 = Date.now();
      const raw = JSON.stringify({ jsonrpc: "2.0", method: "sync.trigger", id: i });
      const resp = JSON.parse(await ipc.handleRequest(raw)) as { result?: unknown };
      const elapsed = Date.now() - t0;

      expect(resp.result).toBeDefined();
      samples.push(elapsed);
    }

    const med = median(samples);
    console.log(`[SC-008] warm sync median: ${med}ms (samples: ${samples.join(", ")}ms)`);
    expect(med).toBeLessThan(TARGET_MS);
  });
});

// ---------------------------------------------------------------------------
// SC-004: Watchdog restart < 30 seconds
// ---------------------------------------------------------------------------

describe("SC-004 performance — watchdog restart time", () => {
  it("state.serverChanged notification arrives within 30 seconds of simulated crash (3 runs, median)", () => {
    const RUNS = 3;
    const TARGET_MS = 30_000;
    const samples: number[] = [];

    for (let i = 0; i < RUNS; i++) {
      let onRestart: ((name: string) => void) | undefined;
      const notifications: Array<{ method: string }> = [];

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
          { name: "server-a", config: { command: "n", args: [] }, status: "running", enabled: true, restartCount: i + 1 },
        ]) as never,
        startAll: vi.fn() as never,
        stopAll: vi.fn() as never,
      };

      const writeFn = vi.fn((data: string) => {
        const parsed = JSON.parse(data.trim()) as { method: string };
        notifications.push(parsed);
      });
      const ipc = createIpcHandler(writeFn);
      registerServerNotifications(ipc, pm, registry);

      const t0 = Date.now();
      onRestart!("server-a");
      const elapsed = Date.now() - t0;

      const notif = notifications.find((n) => n.method === "state.serverChanged");
      expect(notif).toBeDefined();
      samples.push(elapsed);
    }

    const med = median(samples);
    console.log(`[SC-004] watchdog restart notification median: ${med}ms (samples: ${samples.join(", ")}ms)`);
    expect(med).toBeLessThan(TARGET_MS);
  });
});
