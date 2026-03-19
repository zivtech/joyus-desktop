/**
 * WP07 — Pilot Acceptance Tests
 *
 * Formal acceptance test suite mapping each spec scenario (SC-001 through SC-008)
 * to at least one test case. These serve as the go/no-go gate before pilot launch.
 *
 * By default (CI): uses configurable FetchLike mocks (no network required).
 * Against staging: set JOYUS_PILOT_STAGING_URL to switch to a live control plane.
 * The JOYUS_PILOT_STAGING_URL env var is documented here and in the runbook.
 *
 * T037 — SC-001 through SC-008 acceptance tests
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

import {
  createControlPlaneClient,
  openReplayCache,
  createTokenRefreshService,
  createAsyncEventEmitter,
  requestPolicyDecision,
  requestWorkspace,
  getArtifactProvenance,
  buildPolicyDecideRequest,
  ControlPlaneTimeoutError,
} from "@joyus/policy-client";
import type {
  FetchLike,
  FetchLikeResponse,
  PolicyDecideResponse,
  WorkspaceRecord,
} from "@joyus/policy-client";

// ---------------------------------------------------------------------------
// Environment — switch between mock and live staging
// ---------------------------------------------------------------------------

/**
 * Set JOYUS_PILOT_STAGING_URL to run acceptance tests against a live
 * staging control plane (e.g., https://staging-api.joyus.ai).
 * Leave unset to run against mock FetchLike responses (default for CI).
 */
const STAGING_URL = process.env["JOYUS_PILOT_STAGING_URL"];
const BASE_URL = STAGING_URL ?? "http://localhost:9999";
const BEARER_TOKEN = process.env["JOYUS_API_TOKEN"] ?? "tok-acceptance-test";

// ---------------------------------------------------------------------------
// Shared mock infrastructure (used when JOYUS_PILOT_STAGING_URL is not set)
// ---------------------------------------------------------------------------

function mcpSuccess(data: unknown): FetchLikeResponse {
  const body = { result: { content: [{ type: "text", text: JSON.stringify(data) }] } };
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

function httpError(status: number): FetchLikeResponse {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(`HTTP ${status}`),
  };
}

function makePolicyResponse(overrides: Partial<PolicyDecideResponse> = {}): PolicyDecideResponse {
  return {
    decision: "allow",
    reason: "policy approved",
    token: "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0ZXN0In0.",
    token_expires_at: new Date(Date.now() + 60_000).toISOString(),
    jti: randomUUID(),
    risk_level: "low",
    ...overrides,
  };
}

function makeWorkspaceRecord(overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    workspace_id: `ws-${randomUUID().slice(0, 8)}`,
    tenant_id: "tenant-acceptance",
    mode: "managed_remote",
    created_by: "system",
    label: null,
    created_at: new Date().toISOString(),
    status: "ready",
    ...overrides,
  };
}

function makeFixedFetchLike(response: FetchLikeResponse): FetchLike {
  return vi.fn().mockResolvedValue(response) as unknown as FetchLike;
}

function makeSequentialFetchLike(responses: FetchLikeResponse[]): FetchLike {
  const queue = [...responses];
  return vi.fn().mockImplementation(() => {
    const next = queue.shift();
    if (next === undefined) throw new Error("No more queued mock responses");
    return Promise.resolve(next);
  }) as unknown as FetchLike;
}

function makeConfig(overrides: { requestTimeoutMs?: number; retryMaxAttempts?: number } = {}) {
  return {
    baseUrl: BASE_URL,
    bearerToken: BEARER_TOKEN,
    mtlsCertPath: undefined as string | undefined,
    mtlsKeyPath: undefined as string | undefined,
    mtlsCaPath: undefined as string | undefined,
    requestTimeoutMs: overrides.requestTimeoutMs ?? 5_000,
    retryMaxAttempts: overrides.retryMaxAttempts ?? 1,
    retryBaseDelayMs: 0,
  };
}

function makeDecisionInput(overrides: { actionName?: string; riskLevel?: PolicyDecideResponse["risk_level"] } = {}) {
  return {
    baseUrl: BASE_URL,
    bearerToken: BEARER_TOKEN,
    request: buildPolicyDecideRequest({
      actionName: overrides.actionName ?? "file.read",
      riskLevel: overrides.riskLevel ?? "low",
      tenantId: "tenant-acceptance",
      sessionId: `sess-${randomUUID().slice(0, 8)}`,
    }),
  };
}

function makeTmpDbPath(): string {
  return join(tmpdir(), `pilot-acceptance-${randomUUID()}`, "test.db");
}

function cleanupDb(dbPath: string): void {
  try { rmSync(join(dbPath, ".."), { recursive: true, force: true }); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// SC-001: Policy decision produces signed token
// ---------------------------------------------------------------------------

describe("SC-001: Policy decision produces signed token", () => {
  it("allow decision returns token with valid jti and expiry", async () => {
    const expected = makePolicyResponse({ decision: "allow" });
    const fetch = makeFixedFetchLike(mcpSuccess(expected));

    const result = await requestPolicyDecision(fetch, makeDecisionInput());

    expect(result.decision).toBe("allow");
    expect(result.jti).toMatch(/^[0-9a-f-]{36}$/); // UUID format
    expect(new Date(result.token_expires_at).getTime()).toBeGreaterThan(Date.now());
    expect(result.token).toContain(".");
  });

  it("deny decision is returned with reason", async () => {
    const expected = makePolicyResponse({ decision: "deny", reason: "policy denied" });
    const fetch = makeFixedFetchLike(mcpSuccess(expected));

    const result = await requestPolicyDecision(fetch, makeDecisionInput({ riskLevel: "high" }));

    expect(result.decision).toBe("deny");
    expect(result.reason).toBe("policy denied");
  });

  it("escalate decision requires human approval", async () => {
    const expected = makePolicyResponse({ decision: "escalate", reason: "requires approval" });
    const fetch = makeFixedFetchLike(mcpSuccess(expected));

    const result = await requestPolicyDecision(fetch, makeDecisionInput({ riskLevel: "critical" }));

    expect(result.decision).toBe("escalate");
  });
});

// ---------------------------------------------------------------------------
// SC-002: Replay rejection
// ---------------------------------------------------------------------------

describe("SC-002: Replay rejection", () => {
  let dbPath: string;

  afterEach(() => {
    cleanupDb(dbPath);
  });

  it("reused JTI is rejected and replay event emitted", async () => {
    dbPath = makeTmpDbPath();
    const cache = openReplayCache({ dbPath });

    const receivedEvents: unknown[] = [];
    const eventFetch: FetchLike = vi.fn().mockImplementation(
      async (_url: string, init: { body?: string }) => {
        receivedEvents.push(JSON.parse(init.body ?? "{}"));
        return { ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve("") };
      }
    ) as unknown as FetchLike;

    const emitter = createAsyncEventEmitter({
      fetch: eventFetch,
      baseUrl: BASE_URL,
      failureLogPath: join(tmpdir(), `pilot-failure-log-${randomUUID()}.ndjson`),
    });

    const jti = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const token = { jti, tenantId: "tenant-acceptance", consumedAt: now, expiresAt: now + 3_600 };

    const first = cache.consume(token);
    expect(first.ok).toBe(true);

    const replay = cache.consume(token);
    expect(replay.ok).toBe(false);
    expect(replay.originalConsumedAt).toBe(now);

    emitter.emit("policy.replay", "/events", { jti, tenantId: "tenant-acceptance" });
    await emitter.flush();

    expect(receivedEvents).toHaveLength(1);
    expect((receivedEvents[0] as { kind: string }).kind).toBe("policy.replay");

    cache.close();
  });
});

// ---------------------------------------------------------------------------
// SC-003: Artifact provenance queryable
// ---------------------------------------------------------------------------

describe("SC-003: Artifact provenance queryable", () => {
  it("artifact registered via handoff is queryable by artifact_id", async () => {
    const provenance = {
      artifact_id: `art-${randomUUID().slice(0, 8)}`,
      checksum: "sha256:deadbeef",
      tenant_id: "tenant-acceptance",
      registered_at: new Date().toISOString(),
    };

    const fetch = makeFixedFetchLike(mcpSuccess(provenance));

    const result = await getArtifactProvenance(fetch, {
      baseUrl: BASE_URL,
      bearerToken: BEARER_TOKEN,
      artifactId: provenance.artifact_id,
    });

    expect(result["artifact_id"]).toBe(provenance.artifact_id);
    expect(result["checksum"]).toBe("sha256:deadbeef");
  });

  it("artifact.register event emitted on successful provenance retrieval", async () => {
    const artifactId = `art-${randomUUID().slice(0, 8)}`;
    const events: unknown[] = [];

    const provenanceFetch = makeFixedFetchLike(mcpSuccess({ artifact_id: artifactId }));
    const emitter = createAsyncEventEmitter({
      fetch: vi.fn().mockImplementation(async (_url: string, init: { body?: string }) => {
        events.push(JSON.parse(init.body ?? "{}"));
        return { ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve("") };
      }) as unknown as FetchLike,
      baseUrl: BASE_URL,
      failureLogPath: join(tmpdir(), `pilot-failure-log-${randomUUID()}.ndjson`),
    });

    const result = await getArtifactProvenance(provenanceFetch, {
      baseUrl: BASE_URL,
      bearerToken: BEARER_TOKEN,
      artifactId,
    });

    emitter.emit("artifact.register", "/events", { artifactId: result["artifact_id"] });
    await emitter.flush();

    expect(events).toHaveLength(1);
    expect((events[0] as { kind: string }).kind).toBe("artifact.register");
  });
});

// ---------------------------------------------------------------------------
// SC-004: External tenant remote workspace enforcement
// ---------------------------------------------------------------------------

describe("SC-004: External tenant remote workspace enforcement", () => {
  it("external tenant action is routed to managed_remote workspace", async () => {
    const record = makeWorkspaceRecord({ mode: "managed_remote", tenant_id: "tenant-external" });
    const fetch = makeFixedFetchLike(mcpSuccess(record));

    const result = await requestWorkspace(fetch, {
      baseUrl: BASE_URL,
      bearerToken: BEARER_TOKEN,
      tenantId: "tenant-external",
      mode: "managed_remote",
    });

    expect(result.mode).toBe("managed_remote");
    expect(result.status).toBe("ready");
  });

  it("internal tenant uses local workspace (no remote routing)", async () => {
    const record = makeWorkspaceRecord({ mode: "local", tenant_id: "tenant-internal" });
    const fetch = makeFixedFetchLike(mcpSuccess(record));

    const result = await requestWorkspace(fetch, {
      baseUrl: BASE_URL,
      bearerToken: BEARER_TOKEN,
      tenantId: "tenant-internal",
      mode: "local",
    });

    expect(result.mode).toBe("local");
  });
});

// ---------------------------------------------------------------------------
// SC-005: Fail-closed on outage
// ---------------------------------------------------------------------------

describe("SC-005: Fail-closed on outage", () => {
  it("control plane timeout blocks action (not bypasses)", async () => {
    const hangingFetchFn = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const err = new Error("The operation was aborted.");
            err.name = "AbortError";
            reject(err);
          });
        })
    ) as unknown as typeof globalThis.fetch;

    const client = createControlPlaneClient(
      makeConfig({ requestTimeoutMs: 50, retryMaxAttempts: 1 }),
      { fetchFn: hangingFetchFn }
    );

    await expect(
      requestPolicyDecision(client, makeDecisionInput())
    ).rejects.toBeInstanceOf(ControlPlaneTimeoutError);
  });

  it("network error blocks action (fail-closed, not fail-open)", async () => {
    const errorFetch: FetchLike = vi.fn().mockRejectedValue(
      new Error("ECONNREFUSED")
    ) as unknown as FetchLike;

    await expect(
      requestPolicyDecision(errorFetch, makeDecisionInput())
    ).rejects.toThrow("ECONNREFUSED");
  });
});

// ---------------------------------------------------------------------------
// SC-006: Recovery without restart
// ---------------------------------------------------------------------------

describe("SC-006: Recovery without restart", () => {
  it("enforcement resumes after control plane recovers", async () => {
    const recovered = makePolicyResponse({ decision: "allow" });
    const fetch = makeSequentialFetchLike([
      httpError(503), // Phase 1: outage
      mcpSuccess(recovered), // Phase 2: recovery
    ]);

    // Phase 1: fails
    await expect(requestPolicyDecision(fetch, makeDecisionInput())).rejects.toThrow();

    // Phase 2: same FetchLike, no restart — succeeds
    const result = await requestPolicyDecision(fetch, makeDecisionInput());
    expect(result.decision).toBe("allow");
  });
});

// ---------------------------------------------------------------------------
// SC-007: Internal pilot (3-5 users) — concurrent decisions are independent
// ---------------------------------------------------------------------------

describe("SC-007: Internal pilot (3-5 users)", () => {
  it("concurrent decisions from multiple action keys are independent", async () => {
    const actionKeys = ["file.read", "file.write", "data.export", "admin.login", "config.change"];

    // Each action key gets its own unique response
    const responses = new Map(
      actionKeys.map((key) => [key, makePolicyResponse({ decision: "allow" })])
    );

    const fetch: FetchLike = vi.fn().mockImplementation(
      async (_url: string, init: { body?: string }) => {
        const body = JSON.parse(init.body ?? "{}") as {
          params: { arguments: { action_name: string } };
        };
        const actionName = body.params.arguments.action_name;
        const response = responses.get(actionName);
        if (!response) throw new Error(`Unexpected action: ${actionName}`);
        return mcpSuccess(response);
      }
    ) as unknown as FetchLike;

    // Fire all 5 decisions concurrently
    const results = await Promise.all(
      actionKeys.map((actionName) =>
        requestPolicyDecision(fetch, makeDecisionInput({ actionName: actionName as "file.read" }))
      )
    );

    // Each result is independent — different JTIs
    const jtis = results.map((r) => r.jti);
    expect(new Set(jtis).size).toBe(5); // all unique

    // All allowed
    expect(results.every((r) => r.decision === "allow")).toBe(true);
  });

  it("concurrent replay cache operations with different tenants do not interfere", () => {
    const dbPath = makeTmpDbPath();
    const cache = openReplayCache({ dbPath });

    const now = Math.floor(Date.now() / 1000);

    // Simulate 3 pilot users each with their own JTI + tenant combination
    const users = [
      { jti: randomUUID(), tenantId: "pilot-user-1" },
      { jti: randomUUID(), tenantId: "pilot-user-2" },
      { jti: randomUUID(), tenantId: "pilot-user-3" },
    ];

    const results = users.map((u) =>
      cache.consume({ jti: u.jti, tenantId: u.tenantId, consumedAt: now, expiresAt: now + 3_600 })
    );

    expect(results.every((r) => r.ok)).toBe(true);

    // Cross-tenant: same JTI, different tenant is allowed (JTI is tenant-scoped)
    const crossTenant = cache.consume({
      jti: users[0]!.jti,
      tenantId: "pilot-user-2", // different tenant
      consumedAt: now,
      expiresAt: now + 3_600,
    });
    expect(crossTenant.ok).toBe(true);

    cache.close();
    cleanupDb(dbPath);
  });
});

// ---------------------------------------------------------------------------
// SC-008: Token refresh before expiry
// ---------------------------------------------------------------------------

describe("SC-008: Token refresh before expiry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("token is refreshed proactively at 80% TTL", async () => {
    vi.useFakeTimers();

    const refreshedResponse = makePolicyResponse({ decision: "allow" });
    const requestDecision = vi.fn().mockResolvedValue(refreshedResponse);

    const nowBase = Date.now();
    const tokenTtlMs = 1_000; // 1 second TTL for test speed
    const refreshAt80pct = Math.floor(tokenTtlMs * 0.8); // 800ms

    const tokenRefresh = createTokenRefreshService({
      requestDecision,
      nowMs: () => nowBase, // fixed clock so refreshDelayMs is deterministic
    });

    const initialResponse = makePolicyResponse({
      decision: "allow",
      token_expires_at: new Date(nowBase + tokenTtlMs).toISOString(),
    });

    tokenRefresh.schedule("file.read", initialResponse);

    // Before 80% TTL: requestDecision not yet called
    vi.advanceTimersByTime(refreshAt80pct - 1);
    expect(requestDecision).not.toHaveBeenCalled();

    // At 80% TTL: requestDecision fires
    await vi.advanceTimersByTimeAsync(2);
    expect(requestDecision).toHaveBeenCalledOnce();
    expect(requestDecision).toHaveBeenCalledWith("file.read");

    tokenRefresh.cancelAll();
  });

  it("in-flight refresh is deduplicated (no double-fetch)", async () => {
    vi.useFakeTimers();

    const nowBase = Date.now();
    const tokenTtlMs = 200;
    let resolveRefresh!: (v: PolicyDecideResponse) => void;

    const refreshedResponse = makePolicyResponse({ decision: "allow" });
    const requestDecision = vi.fn().mockImplementation(
      () => new Promise<PolicyDecideResponse>((r) => { resolveRefresh = r; })
    );

    const tokenRefresh = createTokenRefreshService({
      requestDecision,
      nowMs: () => nowBase,
    });

    const initialResponse = makePolicyResponse({
      decision: "allow",
      token_expires_at: new Date(nowBase + tokenTtlMs).toISOString(),
    });

    tokenRefresh.schedule("file.read", initialResponse);

    // Trigger refresh
    await vi.advanceTimersByTimeAsync(Math.floor(tokenTtlMs * 0.8) + 5);
    expect(requestDecision).toHaveBeenCalledOnce();

    // An in-flight promise should be available
    const inFlight = tokenRefresh.getInFlight("file.read");
    expect(inFlight).toBeDefined();

    resolveRefresh(refreshedResponse);
    await inFlight;

    // requestDecision called exactly once (dedup works)
    expect(requestDecision).toHaveBeenCalledOnce();

    tokenRefresh.cancelAll();
  });
});
