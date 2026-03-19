import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildMtlsAgent,
  calculateBackoffMs,
  ControlPlaneTimeoutError,
  createControlPlaneClient,
  loadConfigFromEnv,
  type ControlPlaneConfig,
} from "../src/controlPlaneClient";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<ControlPlaneConfig> = {}): ControlPlaneConfig {
  return {
    baseUrl: "https://api.example.com",
    bearerToken: "test-bearer-token",
    mtlsCertPath: undefined,
    mtlsKeyPath: undefined,
    mtlsCaPath: undefined,
    requestTimeoutMs: 5000,
    retryMaxAttempts: 3,
    retryBaseDelayMs: 200,
    ...overrides,
  };
}

function makeResponse(status: number): Response {
  return new Response(null, { status });
}

function makeAbortError(): Error {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

const noopSleep = vi.fn(async (_ms: number) => { /* no-op for tests */ });

// ── loadConfigFromEnv ─────────────────────────────────────────────────────────

describe("loadConfigFromEnv", () => {
  beforeEach(() => {
    vi.stubEnv("JOYUS_API_URL", "https://api.example.com");
    vi.stubEnv("JOYUS_API_TOKEN", "tok_test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws when JOYUS_API_URL is missing", () => {
    vi.stubEnv("JOYUS_API_URL", "");
    expect(() => loadConfigFromEnv()).toThrow("Missing required env var: JOYUS_API_URL");
  });

  it("throws when JOYUS_API_TOKEN is missing", () => {
    vi.stubEnv("JOYUS_API_TOKEN", "");
    expect(() => loadConfigFromEnv()).toThrow("Missing required env var: JOYUS_API_TOKEN");
  });

  it("strips trailing slash from baseUrl", () => {
    vi.stubEnv("JOYUS_API_URL", "https://api.example.com/");
    const config = loadConfigFromEnv();
    expect(config.baseUrl).toBe("https://api.example.com");
  });

  it("applies numeric defaults when env vars are absent", () => {
    const config = loadConfigFromEnv();
    expect(config.requestTimeoutMs).toBe(5000);
    expect(config.retryMaxAttempts).toBe(3);
    expect(config.retryBaseDelayMs).toBe(200);
  });

  it("applies default when numeric env var is not a valid integer", () => {
    vi.stubEnv("JOYUS_REQUEST_TIMEOUT_MS", "not-a-number");
    const config = loadConfigFromEnv();
    expect(config.requestTimeoutMs).toBe(5000);
  });

  it("parses numeric env vars when present", () => {
    vi.stubEnv("JOYUS_REQUEST_TIMEOUT_MS", "1000");
    vi.stubEnv("JOYUS_RETRY_MAX_ATTEMPTS", "5");
    vi.stubEnv("JOYUS_RETRY_BASE_DELAY_MS", "100");
    const config = loadConfigFromEnv();
    expect(config.requestTimeoutMs).toBe(1000);
    expect(config.retryMaxAttempts).toBe(5);
    expect(config.retryBaseDelayMs).toBe(100);
  });

  it("sets mTLS paths when present", () => {
    vi.stubEnv("JOYUS_MTLS_CERT_PATH", "/certs/client.crt");
    vi.stubEnv("JOYUS_MTLS_KEY_PATH", "/certs/client.key");
    vi.stubEnv("JOYUS_MTLS_CA_PATH", "/certs/ca.crt");
    const config = loadConfigFromEnv();
    expect(config.mtlsCertPath).toBe("/certs/client.crt");
    expect(config.mtlsKeyPath).toBe("/certs/client.key");
    expect(config.mtlsCaPath).toBe("/certs/ca.crt");
  });

  it("leaves mTLS paths undefined when not set", () => {
    const config = loadConfigFromEnv();
    expect(config.mtlsCertPath).toBeUndefined();
    expect(config.mtlsKeyPath).toBeUndefined();
    expect(config.mtlsCaPath).toBeUndefined();
  });
});

// ── buildMtlsAgent ────────────────────────────────────────────────────────────

describe("buildMtlsAgent", () => {
  let certPath: string;
  let keyPath: string;
  let caPath: string;

  beforeEach(() => {
    certPath = join(tmpdir(), `test-cert-${randomUUID()}.pem`);
    keyPath = join(tmpdir(), `test-key-${randomUUID()}.pem`);
    caPath = join(tmpdir(), `test-ca-${randomUUID()}.pem`);
    writeFileSync(certPath, "CERT_CONTENT");
    writeFileSync(keyPath, "KEY_CONTENT");
    writeFileSync(caPath, "CA_CONTENT");
  });

  afterEach(() => {
    try { unlinkSync(certPath); } catch { /* already deleted */ }
    try { unlinkSync(keyPath); } catch { /* already deleted */ }
    try { unlinkSync(caPath); } catch { /* already deleted */ }
  });

  it("reads cert and key files and returns them as strings", () => {
    const result = buildMtlsAgent(certPath, keyPath, undefined);
    expect(result.cert).toBe("CERT_CONTENT");
    expect(result.key).toBe("KEY_CONTENT");
  });

  it("returns ca content when caPath is provided", () => {
    const result = buildMtlsAgent(certPath, keyPath, caPath);
    expect(result.ca).toBe("CA_CONTENT");
  });

  it("returns ca as undefined when caPath is undefined", () => {
    const result = buildMtlsAgent(certPath, keyPath, undefined);
    expect(result.ca).toBeUndefined();
  });
});

// ── calculateBackoffMs ────────────────────────────────────────────────────────

describe("calculateBackoffMs", () => {
  it("returns baseDelayMs for attempt 1", () => {
    expect(calculateBackoffMs(200, 1)).toBe(200);
  });

  it("returns 2x baseDelayMs for attempt 2", () => {
    expect(calculateBackoffMs(200, 2)).toBe(400);
  });

  it("returns 4x baseDelayMs for attempt 3", () => {
    expect(calculateBackoffMs(200, 3)).toBe(800);
  });
});

// ── createControlPlaneClient ──────────────────────────────────────────────────

describe("createControlPlaneClient", () => {
  afterEach(() => {
    vi.useRealTimers();
    noopSleep.mockClear();
  });

  it("adds Authorization header to every request", async () => {
    let capturedInit: unknown;
    const mockFetch = vi.fn(async (_url: string, init: unknown) => {
      capturedInit = init;
      return makeResponse(200);
    });
    const client = createControlPlaneClient(makeConfig(), {
      fetchFn: mockFetch as unknown as typeof globalThis.fetch,
    });

    await client("https://api.example.com/test", { method: "POST", headers: {} });

    const headers = (capturedInit as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-bearer-token");
  });

  it("merges caller headers with Authorization header", async () => {
    let capturedInit: unknown;
    const mockFetch = vi.fn(async (_url: string, init: unknown) => {
      capturedInit = init;
      return makeResponse(200);
    });
    const client = createControlPlaneClient(makeConfig(), {
      fetchFn: mockFetch as unknown as typeof globalThis.fetch,
    });

    await client("https://api.example.com/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });

    const headers = (capturedInit as RequestInit).headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["Authorization"]).toBe("Bearer test-bearer-token");
  });

  it("includes body when provided", async () => {
    let capturedInit: unknown;
    const mockFetch = vi.fn(async (_url: string, init: unknown) => {
      capturedInit = init;
      return makeResponse(200);
    });
    const client = createControlPlaneClient(makeConfig(), {
      fetchFn: mockFetch as unknown as typeof globalThis.fetch,
    });

    await client("https://api.example.com/test", {
      method: "POST",
      headers: {},
      body: '{"key":"value"}',
    });

    expect((capturedInit as RequestInit).body).toBe('{"key":"value"}');
  });

  it("omits body when not provided", async () => {
    let capturedInit: unknown;
    const mockFetch = vi.fn(async (_url: string, init: unknown) => {
      capturedInit = init;
      return makeResponse(200);
    });
    const client = createControlPlaneClient(makeConfig(), {
      fetchFn: mockFetch as unknown as typeof globalThis.fetch,
    });

    await client("https://api.example.com/test", { method: "GET", headers: {} });

    expect((capturedInit as RequestInit).body).toBeUndefined();
  });

  it("uses globalThis.fetch when no fetchFn is injected", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(makeResponse(200));
    const client = createControlPlaneClient(makeConfig());
    await client("https://api.example.com/test", { method: "GET", headers: {} });
    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("uses default setTimeout-based sleep when no sleep dep is injected", async () => {
    vi.useFakeTimers();

    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeResponse(503))
      .mockResolvedValueOnce(makeResponse(200));

    // No sleep injected — exercises the default setTimeout-based lambda
    const client = createControlPlaneClient(
      makeConfig({ retryMaxAttempts: 2, retryBaseDelayMs: 10 }),
      { fetchFn: mockFetch as unknown as typeof globalThis.fetch }
    );

    const promise = client("https://api.example.com/test", { method: "GET", headers: {} });
    // advanceTimersByTimeAsync flushes microtasks between timer fires so the
    // async chain (fetch → sleep → retry → fetch) runs to completion
    await vi.advanceTimersByTimeAsync(200);
    const response = await promise;
    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("returns 2xx response directly", async () => {
    const mockFetch = vi.fn(async () => makeResponse(200));
    const client = createControlPlaneClient(makeConfig(), {
      fetchFn: mockFetch as unknown as typeof globalThis.fetch,
    });

    const response = await client("https://api.example.com/test", { method: "GET", headers: {} });
    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns non-retryable 4xx response without retrying", async () => {
    const mockFetch = vi.fn(async () => makeResponse(400));
    const client = createControlPlaneClient(makeConfig({ retryMaxAttempts: 3 }), {
      fetchFn: mockFetch as unknown as typeof globalThis.fetch,
      sleep: noopSleep,
    });

    const response = await client("https://api.example.com/test", { method: "POST", headers: {} });
    expect(response.status).toBe(400);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(noopSleep).not.toHaveBeenCalled();
  });

  it("retries on 503 and succeeds on subsequent attempt", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeResponse(503))
      .mockResolvedValueOnce(makeResponse(200));

    const client = createControlPlaneClient(makeConfig({ retryMaxAttempts: 3 }), {
      fetchFn: mockFetch as unknown as typeof globalThis.fetch,
      sleep: noopSleep,
    });

    const response = await client("https://api.example.com/test", { method: "POST", headers: {} });
    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(noopSleep).toHaveBeenCalledTimes(1);
    expect(noopSleep).toHaveBeenCalledWith(calculateBackoffMs(200, 1));
  });

  it("returns last 503 response after exhausting all retry attempts", async () => {
    const mockFetch = vi.fn(async () => makeResponse(503));

    const client = createControlPlaneClient(makeConfig({ retryMaxAttempts: 2 }), {
      fetchFn: mockFetch as unknown as typeof globalThis.fetch,
      sleep: noopSleep,
    });

    const response = await client("https://api.example.com/test", { method: "POST", headers: {} });
    expect(response.status).toBe(503);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(noopSleep).toHaveBeenCalledTimes(1);
  });

  it("retries all RETRY_STATUSES (429, 502, 504)", async () => {
    for (const status of [429, 502, 504]) {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(makeResponse(status))
        .mockResolvedValueOnce(makeResponse(200));

      const client = createControlPlaneClient(makeConfig({ retryMaxAttempts: 2 }), {
        fetchFn: mockFetch as unknown as typeof globalThis.fetch,
        sleep: noopSleep,
      });

      const response = await client("https://api.example.com/test", { method: "GET", headers: {} });
      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      noopSleep.mockClear();
    }
  });

  it("retries on network error and succeeds on next attempt", async () => {
    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce(makeResponse(200));

    const client = createControlPlaneClient(makeConfig({ retryMaxAttempts: 3 }), {
      fetchFn: mockFetch as unknown as typeof globalThis.fetch,
      sleep: noopSleep,
    });

    const response = await client("https://api.example.com/test", { method: "POST", headers: {} });
    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(noopSleep).toHaveBeenCalledTimes(1);
  });

  it("throws last network error after exhausting all retry attempts", async () => {
    const networkError = new Error("connection refused");
    const mockFetch = vi.fn(async () => { throw networkError; });

    const client = createControlPlaneClient(makeConfig({ retryMaxAttempts: 2 }), {
      fetchFn: mockFetch as unknown as typeof globalThis.fetch,
      sleep: noopSleep,
    });

    await expect(
      client("https://api.example.com/test", { method: "POST", headers: {} })
    ).rejects.toThrow("connection refused");

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(noopSleep).toHaveBeenCalledTimes(1);
  });

  it("throws ControlPlaneTimeoutError when request exceeds requestTimeoutMs", async () => {
    vi.useFakeTimers();

    const mockFetch = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener("abort", () => {
          reject(makeAbortError());
        });
      });
    });

    const config = makeConfig({ requestTimeoutMs: 100, retryMaxAttempts: 1 });
    const client = createControlPlaneClient(config, {
      fetchFn: mockFetch as unknown as typeof globalThis.fetch,
    });

    const promise = client("https://api.example.com/test", { method: "POST", headers: {} });
    vi.advanceTimersByTime(101);

    await expect(promise).rejects.toBeInstanceOf(ControlPlaneTimeoutError);
    const err = await promise.catch((e: unknown) => e);
    expect(err instanceof ControlPlaneTimeoutError && err.url).toBe("https://api.example.com/test");
    expect(err instanceof ControlPlaneTimeoutError && err.timeoutMs).toBe(100);
  });

  it("does not retry AbortError — throws ControlPlaneTimeoutError immediately", async () => {
    vi.useFakeTimers();

    const mockFetch = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener("abort", () => {
          reject(makeAbortError());
        });
      });
    });

    const config = makeConfig({ requestTimeoutMs: 100, retryMaxAttempts: 3 });
    const client = createControlPlaneClient(config, {
      fetchFn: mockFetch as unknown as typeof globalThis.fetch,
      sleep: noopSleep,
    });

    const promise = client("https://api.example.com/test", { method: "POST", headers: {} });
    vi.advanceTimersByTime(101);

    await expect(promise).rejects.toBeInstanceOf(ControlPlaneTimeoutError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(noopSleep).not.toHaveBeenCalled();
  });

  it("clears the abort timer after a successful response", async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    const mockFetch = vi.fn(async () => makeResponse(200));
    const client = createControlPlaneClient(makeConfig(), {
      fetchFn: mockFetch as unknown as typeof globalThis.fetch,
    });

    await client("https://api.example.com/test", { method: "GET", headers: {} });

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it("attaches dispatcher when mTLS cert and key paths are provided", async () => {
    const certPath = join(tmpdir(), `cert-${randomUUID()}.pem`);
    const keyPath = join(tmpdir(), `key-${randomUUID()}.pem`);
    writeFileSync(certPath, "CERT");
    writeFileSync(keyPath, "KEY");

    let capturedOptions: Record<string, unknown> | undefined;
    const mockFetch = vi.fn(async (_url: string, init: unknown) => {
      capturedOptions = init as Record<string, unknown>;
      return makeResponse(200);
    });

    const config = makeConfig({ mtlsCertPath: certPath, mtlsKeyPath: keyPath });
    const client = createControlPlaneClient(config, {
      fetchFn: mockFetch as unknown as typeof globalThis.fetch,
    });

    await client("https://api.example.com/test", { method: "GET", headers: {} });

    expect(capturedOptions?.["dispatcher"]).toBeDefined();

    unlinkSync(certPath);
    unlinkSync(keyPath);
  });

  it("does not attach dispatcher when mTLS cert paths are absent", async () => {
    let capturedOptions: Record<string, unknown> | undefined;
    const mockFetch = vi.fn(async (_url: string, init: unknown) => {
      capturedOptions = init as Record<string, unknown>;
      return makeResponse(200);
    });

    const client = createControlPlaneClient(makeConfig(), {
      fetchFn: mockFetch as unknown as typeof globalThis.fetch,
    });

    await client("https://api.example.com/test", { method: "GET", headers: {} });

    expect(capturedOptions?.["dispatcher"]).toBeUndefined();
  });

  it("applies exponential backoff delays between retries", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeResponse(503))
      .mockResolvedValueOnce(makeResponse(503))
      .mockResolvedValueOnce(makeResponse(200));

    const client = createControlPlaneClient(
      makeConfig({ retryMaxAttempts: 3, retryBaseDelayMs: 100 }),
      {
        fetchFn: mockFetch as unknown as typeof globalThis.fetch,
        sleep: noopSleep,
      }
    );

    await client("https://api.example.com/test", { method: "POST", headers: {} });

    expect(noopSleep).toHaveBeenNthCalledWith(1, 100); // attempt 1: 100 * 2^0
    expect(noopSleep).toHaveBeenNthCalledWith(2, 200); // attempt 2: 100 * 2^1
  });
});
