/**
 * T063 — Sidecar lifecycle integration test.
 *
 * Tests the full sidecar lifecycle using createIpcHandler and createServices
 * directly (unit-level integration) without spawning a child process, since
 * the esbuild bundle may not exist in CI.
 */
import { describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { startSidecar } from "../../src/sidecar/main";
import type { SidecarDeps } from "../../src/sidecar/main";
import type { ServiceDeps } from "../../src/sidecar/services";
import type { JsonRpcResponse } from "../../src/sidecar/ipc-handler";

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
      listServers: vi.fn().mockReturnValue([
        { name: "atlassian-mcp", config: { command: "node", args: ["server.js"] }, status: "running", enabled: true, restartCount: 0 },
        { name: "github-mcp", config: { command: "node", args: ["gh.js"] }, status: "stopped", enabled: true, restartCount: 0 },
      ]) as never,
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

function makeDeps(lines: string[], overrides?: Partial<SidecarDeps>): SidecarDeps & {
  stdoutWrite: ReturnType<typeof vi.fn>;
  stderrWrite: ReturnType<typeof vi.fn>;
  exitFn: ReturnType<typeof vi.fn>;
} {
  const stdoutWrite = vi.fn();
  const stderrWrite = vi.fn();
  const exitFn = vi.fn();
  return {
    stdin: makeReadable(lines),
    stdout: { write: stdoutWrite },
    stderr: { write: stderrWrite },
    exit: exitFn,
    onSignal: vi.fn(),
    onUncaughtException: vi.fn(),
    onUnhandledRejection: vi.fn(),
    nowFn: vi.fn().mockReturnValue(1000),
    serviceDeps: makeStubServiceDeps(),
    isOptedOut: vi.fn().mockReturnValue(false),
    emitTelemetry: vi.fn().mockResolvedValue(undefined),
    stdoutWrite,
    stderrWrite,
    exitFn,
    ...overrides,
  };
}

function waitMs(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseResponse(raw: string): JsonRpcResponse {
  return JSON.parse(raw.trim()) as JsonRpcResponse;
}

function makeRequest(method: string, params?: unknown, id: number | string = 1): string {
  return JSON.stringify({ jsonrpc: "2.0", method, ...(params !== undefined && { params }), id });
}

// ---------------------------------------------------------------------------
// T063: Sidecar lifecycle — spawn, IPC round-trips, shutdown
// ---------------------------------------------------------------------------

describe("sidecar lifecycle — health.check", () => {
  it("responds to health.check with ok:true and uptime_ms", async () => {
    const deps = makeDeps([makeRequest("health.check", undefined, 1)]);
    startSidecar(deps);
    await waitMs();

    expect(deps.stdoutWrite).toHaveBeenCalled();
    const response = parseResponse(deps.stdoutWrite.mock.calls[0]![0] as string);
    expect(response.jsonrpc).toBe("2.0");
    expect(response.id).toBe(1);
    const result = response.result as Record<string, unknown>;
    expect(result["ok"]).toBe(true);
    expect(typeof result["uptime_ms"]).toBe("number");
  });
});

describe("sidecar lifecycle — servers.list", () => {
  it("responds to servers.list with array matching schema", async () => {
    const deps = makeDeps([makeRequest("servers.list", undefined, 2)]);
    startSidecar(deps);
    await waitMs();

    expect(deps.stdoutWrite).toHaveBeenCalled();
    const response = parseResponse(deps.stdoutWrite.mock.calls[0]![0] as string);
    expect(response.jsonrpc).toBe("2.0");
    expect(response.id).toBe(2);
    expect(response.error).toBeUndefined();
    const result = response.result as Array<Record<string, unknown>>;
    expect(result).toHaveLength(2);
    expect(result[0]?.["name"]).toBe("atlassian-mcp");
  });
});

describe("sidecar lifecycle — governance.getMode", () => {
  it("responds to governance.getMode from production startup wiring", async () => {
    const deps = makeDeps([makeRequest("governance.getMode", undefined, 4)]);
    startSidecar(deps);
    await waitMs();

    expect(deps.stdoutWrite).toHaveBeenCalled();
    const response = parseResponse(deps.stdoutWrite.mock.calls[0]![0] as string);
    expect(response.jsonrpc).toBe("2.0");
    expect(response.id).toBe(4);
    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ mode: "off" });
  });
});

describe("sidecar lifecycle — sync.status", () => {
  it("responds to sync.status with a well-formed JSON-RPC response", async () => {
    const deps = makeDeps([makeRequest("sync.status", undefined, 3)]);
    startSidecar(deps);
    await waitMs();

    expect(deps.stdoutWrite).toHaveBeenCalled();
    const response = parseResponse(deps.stdoutWrite.mock.calls[0]![0] as string);
    expect(response.jsonrpc).toBe("2.0");
    expect(response.id).toBe(3);
    expect(response.result !== undefined || response.error !== undefined).toBe(true);
  });
});

describe("sidecar lifecycle — error cases", () => {
  it("returns -32700 for malformed JSON", async () => {
    const deps = makeDeps(["{not valid json"]);
    startSidecar(deps);
    await waitMs();

    expect(deps.stdoutWrite).toHaveBeenCalled();
    const response = parseResponse(deps.stdoutWrite.mock.calls[0]![0] as string);
    expect(response.error?.code).toBe(-32700);
    expect(response.id).toBeNull();
  });

  it("returns -32601 for unknown method", async () => {
    const deps = makeDeps([makeRequest("unknown.method", undefined, 42)]);
    startSidecar(deps);
    await waitMs();

    expect(deps.stdoutWrite).toHaveBeenCalled();
    const response = parseResponse(deps.stdoutWrite.mock.calls[0]![0] as string);
    expect(response.error?.code).toBe(-32601);
    expect(response.id).toBe(42);
  });
});

describe("sidecar lifecycle — concurrent requests", () => {
  it("handles multiple concurrent requests with correct response correlation", async () => {
    const requests = [
      makeRequest("health.check", undefined, 10),
      makeRequest("unknown.method.a", undefined, 11),
      makeRequest("unknown.method.b", undefined, 12),
    ];
    const deps = makeDeps(requests);
    startSidecar(deps);
    await waitMs(100);

    expect(deps.stdoutWrite.mock.calls.length).toBe(3);

    const responses = deps.stdoutWrite.mock.calls.map(
      (call) => parseResponse(call[0] as string)
    );
    const ids = responses.map((r) => r.id);
    expect(ids).toContain(10);
    expect(ids).toContain(11);
    expect(ids).toContain(12);

    const healthResp = responses.find((r) => r.id === 10);
    expect((healthResp?.result as Record<string, unknown>)["ok"]).toBe(true);

    const errResp11 = responses.find((r) => r.id === 11);
    expect(errResp11?.error?.code).toBe(-32601);

    const errResp12 = responses.find((r) => r.id === 12);
    expect(errResp12?.error?.code).toBe(-32601);
  });
});

describe("sidecar lifecycle — SIGTERM shutdown", () => {
  it("exits cleanly within 5 seconds on SIGTERM", async () => {
    let sigHandler: (() => void) | undefined;
    const deps = makeDeps([], {
      onSignal: vi.fn((signal: string, handler: () => void) => {
        if (signal === "SIGTERM") sigHandler = handler;
      }),
    });

    startSidecar(deps);
    expect(sigHandler).toBeDefined();

    const start = Date.now();
    sigHandler!();
    await waitMs(100);

    expect(deps.exitFn).toHaveBeenCalledWith(0);
    expect(Date.now() - start).toBeLessThan(5000);
  });
});
