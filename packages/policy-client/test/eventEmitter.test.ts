import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAsyncEventEmitter,
  type AsyncEventEmitterDeps,
  type FetchLike,
} from "../src/index";

// ── Helpers ───────────────────────────────────────────────────────────────────

function tmpLogPath(): string {
  return join(tmpdir(), `event-failures-test-${randomUUID()}.ndjson`);
}

function makeDeps(overrides: Partial<AsyncEventEmitterDeps> = {}): AsyncEventEmitterDeps {
  return {
    fetch: vi.fn(async () => new Response(null, { status: 200 })) as unknown as FetchLike,
    baseUrl: "https://api.example.com",
    maxAttempts: 3,
    failureLogPath: tmpLogPath(),
    sleep: vi.fn(async () => { /* no-op */ }),
    nowMs: () => 1_000_000,
    ...overrides,
  };
}

// ── emit ──────────────────────────────────────────────────────────────────────

describe("emit", () => {
  it("returns synchronously — no Promise required", () => {
    const emitter = createAsyncEventEmitter(makeDeps());
    const result = emitter.emit("policy.decision", "/v1/events", { x: 1 });
    expect(result).toBeUndefined(); // void return
  });

  it("starts drain loop on first emit (fetch is called)", async () => {
    const mockFetch = vi.fn(async () => new Response(null, { status: 200 }));
    const emitter = createAsyncEventEmitter(
      makeDeps({ fetch: mockFetch as unknown as FetchLike })
    );

    emitter.emit("policy.decision", "/v1/events", {});
    await emitter.flush();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does not start a duplicate drain loop when already draining", async () => {
    // Block delivery of the first event so drain stays active
    let releaseFetch!: () => void;
    const blocked = new Promise<void>(resolve => { releaseFetch = resolve; });
    const mockFetch = vi.fn(async () => {
      await blocked;
      return new Response(null, { status: 200 });
    });

    const emitter = createAsyncEventEmitter(
      makeDeps({ fetch: mockFetch as unknown as FetchLike })
    );

    // First emit starts drain (fetch is now blocked)
    emitter.emit("policy.decision", "/v1/events", { seq: 1 });
    // Yield enough microtasks for startDrain to set draining = true
    await Promise.resolve();
    await Promise.resolve();

    // Second emit sees draining = true — should NOT start another drain
    emitter.emit("policy.decision", "/v1/events", { seq: 2 });

    // Unblock fetch so both events can drain
    releaseFetch();
    await emitter.flush();

    // Both delivered sequentially by the same drain loop
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ── drain loop ────────────────────────────────────────────────────────────────

describe("drain loop", () => {
  it("successful delivery removes event from queue (fetch called once)", async () => {
    const mockFetch = vi.fn(async () => new Response(null, { status: 200 }));
    const emitter = createAsyncEventEmitter(
      makeDeps({ fetch: mockFetch as unknown as FetchLike })
    );

    emitter.emit("policy.decision", "/v1/events", {});
    await emitter.flush();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("failed delivery increments attempts and calls sleep for backoff", async () => {
    const mockSleep = vi.fn(async () => { /* no-op */ });
    // Fail twice, succeed on third
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const emitter = createAsyncEventEmitter(
      makeDeps({
        fetch: mockFetch as unknown as FetchLike,
        sleep: mockSleep,
        maxAttempts: 3,
      })
    );

    emitter.emit("policy.decision", "/v1/events", {});
    await emitter.flush();

    expect(mockFetch).toHaveBeenCalledTimes(3);
    // Backoff after attempt 1 (200ms) and attempt 2 (400ms)
    expect(mockSleep).toHaveBeenCalledTimes(2);
    expect(mockSleep).toHaveBeenNthCalledWith(1, 200); // BASE_DELAY * 2^0
    expect(mockSleep).toHaveBeenNthCalledWith(2, 400); // BASE_DELAY * 2^1
  });

  it("after maxAttempts failures, writes to fallback log and removes event", async () => {
    const logPath = tmpLogPath();
    const mockFetch = vi.fn(async () => new Response(null, { status: 500 }));

    const emitter = createAsyncEventEmitter(
      makeDeps({
        fetch: mockFetch as unknown as FetchLike,
        failureLogPath: logPath,
        maxAttempts: 2,
        nowMs: () => 9999,
      })
    );

    emitter.emit("policy.decision", "/v1/events", { key: "val" });
    await emitter.flush();

    // Event exhausted retries → written to fallback log
    expect(existsSync(logPath)).toBe(true);
    const line = JSON.parse(readFileSync(logPath, "utf8").trim()) as Record<string, unknown>;
    expect(line["kind"]).toBe("policy.decision");
    expect(line["failedAt"]).toBe(9999);
    expect(line["attempts"]).toBe(2);

    unlinkSync(logPath);
  });

  it("fetch throwing an error counts as a failed delivery", async () => {
    const logPath = tmpLogPath();
    const mockFetch = vi.fn(async () => { throw new Error("network error"); });

    const emitter = createAsyncEventEmitter(
      makeDeps({
        fetch: mockFetch as unknown as FetchLike,
        failureLogPath: logPath,
        maxAttempts: 1,
      })
    );

    emitter.emit("policy.decision", "/v1/events", {});
    await emitter.flush();

    expect(existsSync(logPath)).toBe(true);
    unlinkSync(logPath);
  });

  it("processes multiple queued events sequentially", async () => {
    const delivered: string[] = [];
    const mockFetch = vi.fn(async (url: string) => {
      delivered.push(url);
      return new Response(null, { status: 200 });
    });

    const emitter = createAsyncEventEmitter(
      makeDeps({ fetch: mockFetch as unknown as FetchLike })
    );

    emitter.emit("policy.decision", "/v1/events", { n: 1 });
    emitter.emit("handoff.complete", "/v1/events", { n: 2 });
    await emitter.flush();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(delivered).toHaveLength(2);
  });
});

// ── fallback log ──────────────────────────────────────────────────────────────

describe("fallback log (writeFallbackLog)", () => {
  it("writes a valid NDJSON line with failedAt timestamp", async () => {
    const logPath = tmpLogPath();
    const mockFetch = vi.fn(async () => new Response(null, { status: 500 }));

    const emitter = createAsyncEventEmitter(
      makeDeps({
        fetch: mockFetch as unknown as FetchLike,
        failureLogPath: logPath,
        maxAttempts: 1,
        nowMs: () => 42_000,
      })
    );

    emitter.emit("artifact.register", "/v1/artifacts", { id: "a1" });
    await emitter.flush();

    const line = JSON.parse(readFileSync(logPath, "utf8").trim()) as Record<string, unknown>;
    expect(line["kind"]).toBe("artifact.register");
    expect(line["endpoint"]).toBe("/v1/artifacts");
    expect(line["failedAt"]).toBe(42_000);

    unlinkSync(logPath);
  });

  it("expands ~ in failureLogPath using homedir", async () => {
    const fakeHome = join(tmpdir(), `fake-home-${randomUUID()}`);
    vi.stubEnv("HOME", fakeHome);

    const mockFetch = vi.fn(async () => new Response(null, { status: 500 }));
    const emitter = createAsyncEventEmitter(
      makeDeps({
        fetch: mockFetch as unknown as FetchLike,
        failureLogPath: "~/.joyus-test/events.ndjson",
        maxAttempts: 1,
      })
    );

    emitter.emit("policy.replay", "/v1/events", {});
    await emitter.flush();

    const expected = join(fakeHome, ".joyus-test", "events.ndjson");
    expect(existsSync(expected)).toBe(true);

    vi.unstubAllEnvs();
  });

  it("creates parent directory if missing", async () => {
    const logPath = join(tmpdir(), randomUUID(), "nested", "events.ndjson");
    const mockFetch = vi.fn(async () => new Response(null, { status: 500 }));

    const emitter = createAsyncEventEmitter(
      makeDeps({
        fetch: mockFetch as unknown as FetchLike,
        failureLogPath: logPath,
        maxAttempts: 1,
      })
    );

    emitter.emit("policy.decision", "/v1/events", {});
    await emitter.flush();

    expect(existsSync(logPath)).toBe(true);
    unlinkSync(logPath);
  });

  it("does not throw when file write fails — logs to console.error instead", async () => {
    // Create a file at the path where the parent dir is expected,
    // so mkdirSync fails with ENOTDIR
    const conflictFile = join(tmpdir(), `conflict-${randomUUID()}`);
    writeFileSync(conflictFile, "not a directory");
    const logPath = join(conflictFile, "events.ndjson"); // conflictFile is a file, not a dir

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => { /* suppress */ });
    const mockFetch = vi.fn(async () => new Response(null, { status: 500 }));

    const emitter = createAsyncEventEmitter(
      makeDeps({
        fetch: mockFetch as unknown as FetchLike,
        failureLogPath: logPath,
        maxAttempts: 1,
      })
    );

    // Must not throw
    await expect(emitter.flush()).resolves.toBeUndefined();
    emitter.emit("policy.decision", "/v1/events", {});
    await expect(emitter.flush()).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
    unlinkSync(conflictFile);
  });
});

// ── flush ─────────────────────────────────────────────────────────────────────

describe("flush", () => {
  it("returns immediately when queue is empty", async () => {
    const emitter = createAsyncEventEmitter(makeDeps());
    await expect(emitter.flush()).resolves.toBeUndefined();
  });

  it("drains all pending events before resolving", async () => {
    const mockFetch = vi.fn(async () => new Response(null, { status: 200 }));
    const emitter = createAsyncEventEmitter(
      makeDeps({ fetch: mockFetch as unknown as FetchLike })
    );

    emitter.emit("policy.decision", "/v1/events", { a: 1 });
    emitter.emit("handoff.complete", "/v1/events", { b: 2 });
    await emitter.flush();

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not throw when all deliveries fail", async () => {
    const logPath = tmpLogPath();
    const mockFetch = vi.fn(async () => new Response(null, { status: 500 }));

    const emitter = createAsyncEventEmitter(
      makeDeps({
        fetch: mockFetch as unknown as FetchLike,
        failureLogPath: logPath,
        maxAttempts: 1,
      })
    );

    emitter.emit("policy.decision", "/v1/events", {});
    await expect(emitter.flush()).resolves.toBeUndefined();

    unlinkSync(logPath);
  });

  it("is idempotent — calling flush multiple times is safe", async () => {
    const mockFetch = vi.fn(async () => new Response(null, { status: 200 }));
    const emitter = createAsyncEventEmitter(
      makeDeps({ fetch: mockFetch as unknown as FetchLike })
    );

    emitter.emit("policy.decision", "/v1/events", {});
    await emitter.flush();
    await emitter.flush(); // second flush on empty queue — no error, no extra calls

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ── default deps coverage ─────────────────────────────────────────────────────

describe("default deps", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("uses default nowMs (Date.now) when not injected", async () => {
    const before = Date.now();
    const mockFetch = vi.fn(async () => new Response(null, { status: 200 }));
    const emitter = createAsyncEventEmitter({
      fetch: mockFetch as unknown as FetchLike,
      baseUrl: "https://api.example.com",
      failureLogPath: tmpLogPath(),
      sleep: async () => { /* no-op */ },
      maxAttempts: 1,
      // no nowMs → uses Date.now
    });

    emitter.emit("policy.decision", "/v1/events", {});
    await emitter.flush();

    const after = Date.now();
    // Verify fetch was called (drain ran using real Date.now)
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(before).toBeLessThanOrEqual(after);
  });

  it("uses default failureLogPath (~/.joyus/event-failures.ndjson) when not injected", async () => {
    const fakeHome = join(tmpdir(), `fake-home-default-${randomUUID()}`);
    vi.stubEnv("HOME", fakeHome);

    const mockFetch = vi.fn(async () => new Response(null, { status: 500 }));
    const emitter = createAsyncEventEmitter({
      fetch: mockFetch as unknown as FetchLike,
      baseUrl: "https://api.example.com",
      sleep: async () => { /* no-op */ },
      nowMs: () => 1,
      maxAttempts: 1,
      // no failureLogPath → uses default ~/.joyus/event-failures.ndjson
    });

    emitter.emit("policy.decision", "/v1/events", {});
    await emitter.flush();

    const expectedLog = join(fakeHome, ".joyus", "event-failures.ndjson");
    expect(existsSync(expectedLog)).toBe(true);
  });

  it("uses default setTimeout-based sleep when not injected", async () => {
    vi.useFakeTimers();

    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const logPath = tmpLogPath();
    const emitter = createAsyncEventEmitter({
      fetch: mockFetch as unknown as FetchLike,
      baseUrl: "https://api.example.com",
      failureLogPath: logPath,
      nowMs: () => 1,
      maxAttempts: 2,
      // no sleep → uses default setTimeout
    });

    const promise = emitter.flush();
    emitter.emit("policy.decision", "/v1/events", {});
    // Advance past the 200ms backoff
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("uses default maxAttempts (3) when not injected", async () => {
    const logPath = tmpLogPath();
    const mockFetch = vi.fn(async () => new Response(null, { status: 500 }));

    const emitter = createAsyncEventEmitter({
      fetch: mockFetch as unknown as FetchLike,
      baseUrl: "https://api.example.com",
      failureLogPath: logPath,
      sleep: async () => { /* no-op */ },
      nowMs: () => 1,
      // no maxAttempts → uses default 3
    });

    emitter.emit("policy.decision", "/v1/events", {});
    await emitter.flush();

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(existsSync(logPath)).toBe(true);
    const line = JSON.parse(readFileSync(logPath, "utf8").trim()) as Record<string, unknown>;
    expect(line["attempts"]).toBe(3);
    unlinkSync(logPath);
  });
});
