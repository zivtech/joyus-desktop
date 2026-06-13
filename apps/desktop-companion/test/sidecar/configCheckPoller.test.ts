import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  startConfigCheckPoller,
  type ConfigCheckConfig,
} from "../../src/sidecar/configCheckPoller";

// Minimal valid manifest JSON
const VALID_MANIFEST = JSON.stringify({
  schema_version: "1.0",
  tenant_id: "test-tenant",
  bundles: {},
});

const VALID_MANIFEST_V2 = JSON.stringify({
  schema_version: "1.0",
  tenant_id: "test-tenant",
  bundles: { extra: { version: "1" } },
});

function makeFetch(body: string, ok = true): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 503,
    statusText: ok ? "OK" : "Service Unavailable",
    text: () => Promise.resolve(body),
  } as unknown as Response);
}

function makeConfig(overrides: Partial<ConfigCheckConfig> = {}): ConfigCheckConfig {
  return {
    manifestUrl: "https://example.com/manifest.json",
    intervalMs: 1000,
    fetchImpl: makeFetch(VALID_MANIFEST),
    onChangeDetected: vi.fn().mockResolvedValue(undefined),
    now: () => new Date("2024-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

async function flushPoller(intervalMs = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(intervalMs);
}

describe("startConfigCheckPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs an immediate check on start without waiting for interval", async () => {
    const onChangeDetected = vi.fn().mockResolvedValue(undefined);
    const config = makeConfig({ onChangeDetected });

    startConfigCheckPoller(config);

    // No timer advance — immediate tick should fire
    await flushPoller();

    expect(onChangeDetected).toHaveBeenCalledOnce();
  });

  it("unchanged manifest skips callback, updates lastCheckAt", async () => {
    const onChangeDetected = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = makeFetch(VALID_MANIFEST);
    const config = makeConfig({ onChangeDetected, fetchImpl });

    const handle = startConfigCheckPoller(config);
    await flushPoller();

    // First poll: change detected (hash was undefined → new hash)
    expect(onChangeDetected).toHaveBeenCalledOnce();
    onChangeDetected.mockClear();

    // Second poll: same content
    await flushPoller(1000);

    expect(onChangeDetected).not.toHaveBeenCalled();
    expect(handle.getState().lastCheckAt).toBe("2024-01-01T00:00:00.000Z");
  });

  it("changed manifest triggers callback with parsed manifest and updates hash", async () => {
    const onChangeDetected = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(VALID_MANIFEST) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(VALID_MANIFEST_V2) } as unknown as Response);

    const config = makeConfig({ onChangeDetected, fetchImpl });

    startConfigCheckPoller(config);
    await flushPoller();

    expect(onChangeDetected).toHaveBeenCalledOnce();
    onChangeDetected.mockClear();

    await flushPoller(1000);

    expect(onChangeDetected).toHaveBeenCalledOnce();
    const manifest = onChangeDetected.mock.calls[0]?.[0];
    expect(manifest).toMatchObject({ schema_version: "1.0", tenant_id: "test-tenant" });
  });

  it("network failure increments consecutiveFailures, calls onPollError, preserves lastVersionHash", async () => {
    const onPollError = vi.fn();
    const fetchError = new Error("Network error");
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(VALID_MANIFEST) } as unknown as Response)
      .mockRejectedValueOnce(fetchError);

    const config = makeConfig({ fetchImpl, onPollError });

    const handle = startConfigCheckPoller(config);
    await flushPoller();

    const hashAfterFirst = handle.getState().lastVersionHash;
    expect(hashAfterFirst).toBeDefined();

    await flushPoller(1000);

    const state = handle.getState();
    expect(state.consecutiveFailures).toBe(1);
    expect(onPollError).toHaveBeenCalledWith(fetchError);
    expect(state.lastVersionHash).toBe(hashAfterFirst);
  });

  it("non-OK HTTP response is treated as transport failure before parsing", async () => {
    const onPollError = vi.fn();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve(VALID_MANIFEST) } as unknown as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        text: vi.fn().mockResolvedValue("{\"schema_version\":\"1.0\"}"),
      } as unknown as Response);

    const config = makeConfig({ fetchImpl, onPollError });

    const handle = startConfigCheckPoller(config);
    await flushPoller();

    const hashAfterFirst = handle.getState().lastVersionHash;
    await flushPoller(1000);

    const state = handle.getState();
    expect(state.consecutiveFailures).toBe(1);
    expect(state.lastVersionHash).toBe(hashAfterFirst);
    expect(onPollError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Config check request failed with HTTP 503 Service Unavailable",
      }),
    );
    expect(config.onChangeDetected).not.toHaveBeenCalledTimes(2);
  });

  it("invalid JSON response is treated as error, state preserved", async () => {
    const onPollError = vi.fn();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(VALID_MANIFEST) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve("not { valid json") } as unknown as Response);

    const config = makeConfig({ fetchImpl, onPollError });

    const handle = startConfigCheckPoller(config);
    await flushPoller();

    const hashAfterFirst = handle.getState().lastVersionHash;

    await flushPoller(1000);

    const state = handle.getState();
    expect(state.consecutiveFailures).toBe(1);
    expect(onPollError).toHaveBeenCalledOnce();
    expect(state.lastVersionHash).toBe(hashAfterFirst);
  });

  it("invalid manifest (valid JSON but fails validation) is treated as error", async () => {
    const onPollError = vi.fn();
    const invalidManifest = JSON.stringify({ not_a_manifest: true });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(VALID_MANIFEST) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(invalidManifest) } as unknown as Response);

    const config = makeConfig({ fetchImpl, onPollError });

    const handle = startConfigCheckPoller(config);
    await flushPoller();

    const hashAfterFirst = handle.getState().lastVersionHash;

    await flushPoller(1000);

    const state = handle.getState();
    expect(state.consecutiveFailures).toBe(1);
    expect(onPollError).toHaveBeenCalledOnce();
    expect(state.lastVersionHash).toBe(hashAfterFirst);
  });

  it("callback failure does NOT update hash, increments consecutiveFailures", async () => {
    const callbackError = new Error("Callback exploded");
    const onChangeDetected = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(callbackError);
    const onPollError = vi.fn();

    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(VALID_MANIFEST) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(VALID_MANIFEST_V2) } as unknown as Response);

    const config = makeConfig({ fetchImpl, onChangeDetected, onPollError });

    const handle = startConfigCheckPoller(config);
    await flushPoller();

    // First poll: success, hash set to VALID_MANIFEST hash
    const hashAfterFirst = handle.getState().lastVersionHash;
    expect(hashAfterFirst).toBeDefined();

    await flushPoller(1000);

    // Second poll: different content but callback throws
    const state = handle.getState();
    // Hash should still be the first hash (not updated to v2 hash)
    expect(state.lastVersionHash).toBe(hashAfterFirst);
    expect(state.consecutiveFailures).toBe(1);
    expect(onPollError).toHaveBeenCalledWith(callbackError);
  });

  it("stop clears the interval so no more polls fire", async () => {
    const onChangeDetected = vi.fn().mockResolvedValue(undefined);
    const config = makeConfig({ onChangeDetected });

    const handle = startConfigCheckPoller(config);
    await flushPoller();

    expect(onChangeDetected).toHaveBeenCalledOnce();
    onChangeDetected.mockClear();

    handle.stop();

    await flushPoller(5000);

    expect(onChangeDetected).not.toHaveBeenCalled();
  });

  it("stop is idempotent — calling twice does not throw", async () => {
    const config = makeConfig();
    const handle = startConfigCheckPoller(config);
    await flushPoller();

    expect(() => {
      handle.stop();
      handle.stop();
    }).not.toThrow();
  });

  it("getState returns a snapshot of current state", async () => {
    const now1 = new Date("2024-01-01T00:00:00.000Z");
    const now2 = new Date("2024-01-01T00:05:00.000Z");
    let callCount = 0;
    const now = () => (callCount++ === 0 ? now1 : now2);

    const config = makeConfig({ now });

    const handle = startConfigCheckPoller(config);
    await flushPoller();

    const state = handle.getState();
    expect(state.lastCheckAt).toBe("2024-01-01T00:00:00.000Z");
    expect(state.consecutiveFailures).toBe(0);
    expect(state.lastVersionHash).toBeDefined();

    // Mutating the returned snapshot should not affect internal state
    const snapshot = handle.getState() as { consecutiveFailures: number };
    snapshot.consecutiveFailures = 999;
    expect(handle.getState().consecutiveFailures).toBe(0);
  });

  it("overlapping tick protection: second tick skipped if first still running", async () => {
    let resolveFirst!: () => void;
    const slowFetch = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFirst = () =>
          resolve({ ok: true, text: () => Promise.resolve(VALID_MANIFEST) } as unknown as Response);
      }),
    );

    const onChangeDetected = vi.fn().mockResolvedValue(undefined);
    const config = makeConfig({ fetchImpl: slowFetch, onChangeDetected, intervalMs: 100 });

    startConfigCheckPoller(config);

    // First tick started but not resolved yet
    vi.advanceTimersByTime(100);
    // Second interval fires while first is still pending
    vi.advanceTimersByTime(100);

    // Now resolve the first fetch
    resolveFirst();
    await flushPoller();

    // The immediate tick holds the polling lock, so interval fires are skipped until it settles.
    expect(onChangeDetected).toHaveBeenCalledOnce();
    expect(slowFetch).toHaveBeenCalledTimes(1);
  });

  it("onPollError is optional — no error thrown when not provided", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("Network error"));
    const config = makeConfig({ fetchImpl, onPollError: undefined });

    const handle = startConfigCheckPoller(config);
    await expect(flushPoller()).resolves.not.toThrow();

    expect(handle.getState().consecutiveFailures).toBe(1);
  });

  it("uses the global fetch and default clock when fetchImpl and now are omitted", async () => {
    const originalFetch = globalThis.fetch;
    const globalFetch = vi.fn().mockResolvedValue({
      text: () => Promise.resolve(VALID_MANIFEST),
    } as unknown as Response);
    const onChangeDetected = vi.fn().mockResolvedValue(undefined);

    globalThis.fetch = globalFetch;

    try {
      const handle = startConfigCheckPoller({
        manifestUrl: "https://example.com/manifest.json",
        intervalMs: 1000,
        onChangeDetected,
      });

      await flushPoller();

      expect(globalFetch).toHaveBeenCalledWith("https://example.com/manifest.json");
      expect(handle.getState().lastCheckAt).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("normalizes non-Error fetch failures before reporting them", async () => {
    const onPollError = vi.fn();
    const fetchImpl = vi.fn().mockRejectedValue("network exploded");

    startConfigCheckPoller(makeConfig({ fetchImpl, onPollError }));
    await flushPoller();

    expect(onPollError).toHaveBeenCalledWith(expect.any(Error));
    expect(onPollError.mock.calls[0]?.[0]?.message).toBe("network exploded");
  });

  it("normalizes non-Error JSON parsing failures before reporting them", async () => {
    const onPollError = vi.fn();
    const fetchImpl = makeFetch(VALID_MANIFEST_V2);
    const parseSpy = vi.spyOn(JSON, "parse").mockImplementation(() => {
      throw "bad json";
    });

    try {
      startConfigCheckPoller(makeConfig({ fetchImpl, onPollError }));
      await flushPoller();
    } finally {
      parseSpy.mockRestore();
    }

    expect(onPollError).toHaveBeenCalledWith(expect.any(Error));
    expect(onPollError.mock.calls[0]?.[0]?.message).toBe("bad json");
  });

  it("normalizes non-Error callback failures before reporting them", async () => {
    const onPollError = vi.fn();
    const onChangeDetected = vi.fn().mockRejectedValue("callback exploded");

    startConfigCheckPoller(makeConfig({ onChangeDetected, onPollError }));
    await flushPoller();

    expect(onPollError).toHaveBeenCalledWith(expect.any(Error));
    expect(onPollError.mock.calls[0]?.[0]?.message).toBe("callback exploded");
  });

  it("uses default 300_000ms interval when intervalMs not specified", async () => {
    const onChangeDetected = vi.fn().mockResolvedValue(undefined);
    const config: ConfigCheckConfig = {
      manifestUrl: "https://example.com/manifest.json",
      fetchImpl: makeFetch(VALID_MANIFEST),
      onChangeDetected,
      now: () => new Date("2024-01-01T00:00:00.000Z"),
    };

    startConfigCheckPoller(config);
    await flushPoller();

    expect(onChangeDetected).toHaveBeenCalledOnce();
    onChangeDetected.mockClear();

    // Should NOT fire before 300_000ms
    await flushPoller(299_999);
    expect(onChangeDetected).not.toHaveBeenCalled();

    // Should fire at exactly 300_000ms (same content → no callback)
    await flushPoller(1);
    expect(onChangeDetected).not.toHaveBeenCalled(); // same hash, no change
  });

  it("lastChangeAt is set on successful change detection", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(VALID_MANIFEST) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(VALID_MANIFEST_V2) } as unknown as Response);

    let tick = 0;
    const timestamps = [
      "2024-01-01T00:00:00.000Z",
      "2024-01-01T00:00:01.000Z",
      "2024-01-01T00:05:00.000Z",
      "2024-01-01T00:05:01.000Z",
    ];
    const now = () => new Date(timestamps[tick++] ?? "2024-01-01T00:05:01.000Z");

    const config = makeConfig({ fetchImpl, now });
    const handle = startConfigCheckPoller(config);
    await flushPoller();

    expect(handle.getState().lastChangeAt).toBe("2024-01-01T00:00:01.000Z");

    await flushPoller(1000);

    expect(handle.getState().lastChangeAt).toBe("2024-01-01T00:05:01.000Z");
  });

  it("consecutiveFailures resets to 0 after a successful change detection", async () => {
    const fetchError = new Error("Transient error");
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(fetchError)
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(VALID_MANIFEST) } as unknown as Response);

    const onChangeDetected = vi.fn().mockResolvedValue(undefined);
    const config = makeConfig({ fetchImpl, onChangeDetected });

    const handle = startConfigCheckPoller(config);
    await flushPoller();

    expect(handle.getState().consecutiveFailures).toBe(1);

    await flushPoller(1000);

    expect(handle.getState().consecutiveFailures).toBe(0);
    expect(onChangeDetected).toHaveBeenCalledOnce();
  });

  it("normalizes non-Error manifest validation failures before reporting them", async () => {
    vi.resetModules();
    vi.doMock("@joyus/settings-reconciler", async () => {
      const actual =
        await vi.importActual<typeof import("@joyus/settings-reconciler")>(
          "@joyus/settings-reconciler",
        );

      return {
        ...actual,
        validateManifest: () => {
          throw "bad manifest";
        },
      };
    });

    try {
      const { startConfigCheckPoller: startPollerWithMockedValidator } = await import(
        "../../src/sidecar/configCheckPoller"
      );
      const onPollError = vi.fn();

      startPollerWithMockedValidator({
        manifestUrl: "https://example.com/manifest.json",
        intervalMs: 1000,
        fetchImpl: makeFetch(VALID_MANIFEST),
        onChangeDetected: vi.fn().mockResolvedValue(undefined),
        onPollError,
        now: () => new Date("2024-01-01T00:00:00.000Z"),
      });
      await flushPoller();

      expect(onPollError).toHaveBeenCalledWith(expect.any(Error));
      expect(onPollError.mock.calls[0]?.[0]?.message).toBe("bad manifest");
    } finally {
      vi.doUnmock("@joyus/settings-reconciler");
      vi.resetModules();
    }
  });
});
