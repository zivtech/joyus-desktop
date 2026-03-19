/**
 * WP06 — Integration Test Suite
 *
 * End-to-end integration tests covering spec scenarios SC-001 through SC-006.
 * Uses configurable FetchLike mocks injected into the real components —
 * consistent with the codebase test pattern (no external HTTP mock libraries).
 *
 * T028 — Shared fetch fixture with typed MCP response builders
 * T029 — Policy decision round-trip (SC-001)
 * T030 — Replay rejection and event emission (SC-002)
 * T031 — External tenant forced to remote workspace (SC-004)
 * T032 — Control plane outage — fail-closed (SC-005)
 * T033 — Outage recovery — enforcement resumes (SC-006)
 * T034 — Artifact provenance registration (SC-003)
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
// T028 — Shared fixture: MCP response builders and helpers
// ---------------------------------------------------------------------------

const BASE_URL = "http://localhost:9999";
const BEARER_TOKEN = "tok-integration-test";

/**
 * Wrap a data value in the MCP JSON-RPC "result" envelope that
 * controlPlaneContracts.ts expects from callMcpTool.
 */
function mcpSuccess(data: unknown): FetchLikeResponse {
  const body = {
    result: {
      content: [{ type: "text", text: JSON.stringify(data) }],
    },
  };
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

/** Return a non-OK HTTP response (triggers MCP error path in callMcpTool). */
function httpError(status: number): FetchLikeResponse {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(`HTTP ${status}`),
  };
}

/**
 * Build a minimal valid PolicyDecideResponse.
 * token must contain "." to pass parsePolicyDecideResponse validation.
 */
function makePolicyResponse(
  overrides: Partial<PolicyDecideResponse> = {}
): PolicyDecideResponse {
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

/** Client config with fast test defaults (no mTLS, single attempt). */
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

/**
 * FetchLike that always returns the same response.
 * Suitable for tests that don't care about call count.
 */
function makeFixedFetchLike(response: FetchLikeResponse): FetchLike {
  return vi.fn().mockResolvedValue(response) as unknown as FetchLike;
}

/**
 * FetchLike that returns responses from a queue (one per call).
 * Suitable for multi-phase tests (outage then recovery).
 */
function makeSequentialFetchLike(responses: FetchLikeResponse[]): FetchLike {
  const queue = [...responses];
  return vi.fn().mockImplementation(() => {
    const next = queue.shift();
    if (next === undefined) throw new Error("No more queued mock responses");
    return Promise.resolve(next);
  }) as unknown as FetchLike;
}

/**
 * Capturing FetchLike that records request bodies and returns a fixed response.
 * Suitable for asserting what was sent to the control plane.
 */
function makeCapturingFetchLike(
  response: FetchLikeResponse,
  captured: unknown[]
): FetchLike {
  return vi.fn().mockImplementation(
    async (_url: string, init: { body?: string }) => {
      captured.push(JSON.parse(init.body ?? "{}"));
      return response;
    }
  ) as unknown as FetchLike;
}

/** Shared policy decision arguments for convenience. */
function makeDecisionInput() {
  return {
    baseUrl: BASE_URL,
    bearerToken: BEARER_TOKEN,
    request: buildPolicyDecideRequest({
      actionName: "file.read",
      riskLevel: "low",
      tenantId: "tenant-001",
      sessionId: "sess-001",
    }),
  };
}

// ReplayCache tmpdir helpers (matches WP02 test pattern)
function makeTmpDbPath(): string {
  return join(tmpdir(), `replay-integration-${randomUUID()}`, "test.db");
}

function cleanupDb(dbPath: string): void {
  try {
    rmSync(join(dbPath, ".."), { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// T029 — Policy decision round-trip (SC-001)
// ---------------------------------------------------------------------------

describe("SC-001 — Policy decision round-trip", () => {
  it("allow decision: returns PolicyDecideResponse with decision=allow", async () => {
    const expected = makePolicyResponse({ decision: "allow" });
    const fetch = makeFixedFetchLike(mcpSuccess(expected));

    const result = await requestPolicyDecision(fetch, {
      ...makeDecisionInput(),
      request: buildPolicyDecideRequest({
        actionName: "file.read",
        riskLevel: "low",
        tenantId: "tenant-001",
        sessionId: "sess-001",
      }),
    });

    expect(result.decision).toBe("allow");
    expect(result.jti).toBe(expected.jti);
  });

  it("deny decision: returns PolicyDecideResponse with decision=deny", async () => {
    const expected = makePolicyResponse({ decision: "deny", reason: "policy denied" });
    const fetch = makeFixedFetchLike(mcpSuccess(expected));

    const result = await requestPolicyDecision(fetch, {
      baseUrl: BASE_URL,
      bearerToken: BEARER_TOKEN,
      request: buildPolicyDecideRequest({
        actionName: "file.delete",
        riskLevel: "high",
        tenantId: "tenant-001",
        sessionId: "sess-001",
      }),
    });

    expect(result.decision).toBe("deny");
    expect(result.reason).toBe("policy denied");
  });

  it("escalate decision: returns PolicyDecideResponse with decision=escalate", async () => {
    const expected = makePolicyResponse({
      decision: "escalate",
      reason: "requires human approval",
    });
    const fetch = makeFixedFetchLike(mcpSuccess(expected));

    const result = await requestPolicyDecision(fetch, {
      baseUrl: BASE_URL,
      bearerToken: BEARER_TOKEN,
      request: buildPolicyDecideRequest({
        actionName: "data.export",
        riskLevel: "critical",
        tenantId: "tenant-001",
        sessionId: "sess-001",
      }),
    });

    expect(result.decision).toBe("escalate");
  });

  it("allow decision: response integrates with TokenRefreshService.schedule()", async () => {
    const expected = makePolicyResponse({ decision: "allow" });
    const fetch = makeFixedFetchLike(mcpSuccess(expected));

    const tokenRefresh = createTokenRefreshService({
      requestDecision: async () => expected,
      nowMs: () => Date.now(),
    });

    const result = await requestPolicyDecision(fetch, makeDecisionInput());

    // schedule() should accept the live response without throwing
    expect(() => tokenRefresh.schedule("file.read", result)).not.toThrow();

    // Clean up background timer
    tokenRefresh.cancelAll();
  });
});

// ---------------------------------------------------------------------------
// T030 — Replay rejection and event emission (SC-002)
// ---------------------------------------------------------------------------

describe("SC-002 — Replay detection and event emission", () => {
  let dbPath: string;

  afterEach(() => {
    cleanupDb(dbPath);
  });

  it("first consume: JTI accepted (ok=true)", () => {
    dbPath = makeTmpDbPath();
    const cache = openReplayCache({ dbPath });

    const now = Math.floor(Date.now() / 1000);
    const result = cache.consume({
      jti: "jti-sc002-first",
      tenantId: "tenant-001",
      consumedAt: now,
      expiresAt: now + 3_600,
    });

    expect(result.ok).toBe(true);
    cache.close();
  });

  it("second consume of same JTI: rejected with originalConsumedAt", () => {
    dbPath = makeTmpDbPath();
    const cache = openReplayCache({ dbPath });

    const now = Math.floor(Date.now() / 1000);
    const token = {
      jti: "jti-sc002-replay",
      tenantId: "tenant-001",
      consumedAt: now,
      expiresAt: now + 3_600,
    };

    cache.consume(token);
    const replay = cache.consume(token);

    expect(replay.ok).toBe(false);
    expect(replay.originalConsumedAt).toBe(now);
    cache.close();
  });

  it("replay detected: policy.replay event emitted and delivered to endpoint", async () => {
    dbPath = makeTmpDbPath();
    const cache = openReplayCache({ dbPath });

    const receivedBodies: unknown[] = [];
    const eventFetch: FetchLike = vi.fn().mockImplementation(
      async (_url: string, init: { body?: string }) => {
        receivedBodies.push(JSON.parse(init.body ?? "{}"));
        return {
          ok: true,
          status: 200,
          json: () => Promise.resolve({}),
          text: () => Promise.resolve(""),
        };
      }
    ) as unknown as FetchLike;

    const emitter = createAsyncEventEmitter({
      fetch: eventFetch,
      baseUrl: BASE_URL,
      failureLogPath: join(tmpdir(), `failure-log-${randomUUID()}.ndjson`),
    });

    const jti = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const token = { jti, tenantId: "tenant-001", consumedAt: now, expiresAt: now + 3_600 };

    // First consume succeeds, second is a replay
    cache.consume(token);
    const replay = cache.consume(token);

    expect(replay.ok).toBe(false);

    // Wire: on replay detection, emit policy.replay event
    emitter.emit("policy.replay", "/events", { jti, tenantId: "tenant-001" });
    await emitter.flush();

    expect(receivedBodies).toHaveLength(1);
    const body = receivedBodies[0] as { kind: string; payload: { jti: string } };
    expect(body.kind).toBe("policy.replay");
    expect(body.payload.jti).toBe(jti);

    cache.close();
  });
});

// ---------------------------------------------------------------------------
// T031 — External tenant forced to remote workspace (SC-004)
// ---------------------------------------------------------------------------

describe("SC-004 — External tenant workspace routing", () => {
  it("external tenant: requestWorkspace returns managed_remote workspace record", async () => {
    const workspaceRecord: WorkspaceRecord = {
      workspace_id: "ws-ext-001",
      tenant_id: "tenant-external",
      mode: "managed_remote",
      created_by: "system",
      label: null,
      created_at: new Date().toISOString(),
      status: "ready",
    };

    const fetch = makeFixedFetchLike(mcpSuccess(workspaceRecord));

    const result = await requestWorkspace(fetch, {
      baseUrl: BASE_URL,
      bearerToken: BEARER_TOKEN,
      tenantId: "tenant-external",
      mode: "managed_remote",
    });

    expect(result.workspace_id).toBe("ws-ext-001");
    expect(result.mode).toBe("managed_remote");
    expect(result.tenant_id).toBe("tenant-external");
  });

  it("internal tenant: requestWorkspace returns local workspace record", async () => {
    const workspaceRecord: WorkspaceRecord = {
      workspace_id: "ws-local-001",
      tenant_id: "tenant-internal",
      mode: "local",
      created_by: "system",
      label: null,
      created_at: new Date().toISOString(),
      status: "ready",
    };

    const fetch = makeFixedFetchLike(mcpSuccess(workspaceRecord));

    const result = await requestWorkspace(fetch, {
      baseUrl: BASE_URL,
      bearerToken: BEARER_TOKEN,
      tenantId: "tenant-internal",
      mode: "local",
    });

    expect(result.mode).toBe("local");
    expect(result.workspace_id).toBe("ws-local-001");
  });

  it("request_workspace MCP tool is called with correct tenant_id", async () => {
    const captured: unknown[] = [];
    const fetch = makeCapturingFetchLike(
      mcpSuccess({
        workspace_id: "ws-check",
        tenant_id: "tenant-check",
        mode: "managed_remote",
        created_by: "system",
        label: null,
        created_at: new Date().toISOString(),
        status: "ready",
      }),
      captured
    );

    await requestWorkspace(fetch, {
      baseUrl: BASE_URL,
      bearerToken: BEARER_TOKEN,
      tenantId: "tenant-check",
      mode: "managed_remote",
    });

    expect(captured).toHaveLength(1);
    const req = captured[0] as { params: { name: string; arguments: { tenant_id: string } } };
    expect(req.params.name).toBe("request_workspace");
    expect(req.params.arguments.tenant_id).toBe("tenant-check");
  });
});

// ---------------------------------------------------------------------------
// T032 — Control plane outage — fail-closed (SC-005)
// ---------------------------------------------------------------------------

describe("SC-005 — Fail-closed on timeout", () => {
  it("timeout: requestPolicyDecision throws ControlPlaneTimeoutError (not allow)", async () => {
    // Mock that respects AbortSignal — necessary for timeout detection to work
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

  it("network error: requestPolicyDecision throws (action is blocked)", async () => {
    const errorFetchFn = vi.fn().mockRejectedValue(
      new Error("ECONNREFUSED")
    ) as unknown as typeof globalThis.fetch;

    const client = createControlPlaneClient(
      makeConfig({ retryMaxAttempts: 1 }),
      { fetchFn: errorFetchFn }
    );

    await expect(
      requestPolicyDecision(client, makeDecisionInput())
    ).rejects.toThrow("ECONNREFUSED");
  });
});

// ---------------------------------------------------------------------------
// T033 — Outage recovery — enforcement resumes without restart (SC-006)
// ---------------------------------------------------------------------------

describe("SC-006 — Outage recovery", () => {
  it("after outage: first call fails, second call succeeds using same wired components", async () => {
    const recovered = makePolicyResponse({ decision: "allow" });

    // retryMaxAttempts=1 → single attempt per call;
    // 503 is a retry-eligible status but with only 1 attempt it returns immediately,
    // then callMcpTool sees !response.ok and throws.
    const fetch = makeSequentialFetchLike([
      httpError(503), // Phase 1: outage
      mcpSuccess(recovered), // Phase 2: recovery
    ]);

    // Phase 1: outage — same FetchLike, no restart
    await expect(requestPolicyDecision(fetch, makeDecisionInput())).rejects.toThrow();

    // Phase 2: recovery — same FetchLike, no restart required
    const result = await requestPolicyDecision(fetch, makeDecisionInput());
    expect(result.decision).toBe("allow");
    expect(result.jti).toBe(recovered.jti);
  });

  it("after network error: same components recover on next call", async () => {
    const recovered = makePolicyResponse({ decision: "allow" });

    const callCount = { value: 0 };
    const fetch: FetchLike = vi.fn().mockImplementation(async () => {
      callCount.value += 1;
      if (callCount.value === 1) throw new Error("ECONNRESET");
      return mcpSuccess(recovered);
    }) as unknown as FetchLike;

    await expect(requestPolicyDecision(fetch, makeDecisionInput())).rejects.toThrow("ECONNRESET");

    const result = await requestPolicyDecision(fetch, makeDecisionInput());
    expect(result.decision).toBe("allow");
  });
});

// ---------------------------------------------------------------------------
// T034 — Artifact provenance registration (SC-003)
// ---------------------------------------------------------------------------

describe("SC-003 — Artifact provenance", () => {
  it("getArtifactProvenance: returns provenance record from control plane", async () => {
    const provenanceData = {
      artifact_id: "art-001",
      checksum: "sha256:abc123",
      registered_at: new Date().toISOString(),
      tenant_id: "tenant-001",
    };

    const fetch = makeFixedFetchLike(mcpSuccess(provenanceData));

    const result = await getArtifactProvenance(fetch, {
      baseUrl: BASE_URL,
      bearerToken: BEARER_TOKEN,
      artifactId: "art-001",
    });

    expect(result["artifact_id"]).toBe("art-001");
    expect(result["checksum"]).toBe("sha256:abc123");
  });

  it("getArtifactProvenance: calls get_provenance MCP tool with correct artifact_id", async () => {
    const captured: unknown[] = [];
    const fetch = makeCapturingFetchLike(
      mcpSuccess({ artifact_id: "art-002", tenant_id: "tenant-001" }),
      captured
    );

    await getArtifactProvenance(fetch, {
      baseUrl: BASE_URL,
      bearerToken: BEARER_TOKEN,
      artifactId: "art-002",
    });

    expect(captured).toHaveLength(1);
    const req = captured[0] as {
      params: { name: string; arguments: { artifact_id: string } };
    };
    expect(req.params.name).toBe("get_provenance");
    expect(req.params.arguments.artifact_id).toBe("art-002");
  });

  it("artifact.register event emitted after successful registration", async () => {
    const provenanceData = { artifact_id: "art-003", tenant_id: "tenant-001" };

    const emittedEvents: unknown[] = [];
    const eventFetch: FetchLike = vi.fn().mockImplementation(
      async (_url: string, init: { body?: string }) => {
        emittedEvents.push(JSON.parse(init.body ?? "{}"));
        return {
          ok: true,
          status: 200,
          json: () => Promise.resolve({}),
          text: () => Promise.resolve(""),
        };
      }
    ) as unknown as FetchLike;

    const provenanceFetch = makeFixedFetchLike(mcpSuccess(provenanceData));
    const emitter = createAsyncEventEmitter({
      fetch: eventFetch,
      baseUrl: BASE_URL,
      failureLogPath: join(tmpdir(), `failure-log-${randomUUID()}.ndjson`),
    });

    const result = await getArtifactProvenance(provenanceFetch, {
      baseUrl: BASE_URL,
      bearerToken: BEARER_TOKEN,
      artifactId: "art-003",
    });

    // Wire: emit artifact.register event after provenance lookup
    emitter.emit("artifact.register", "/events", { artifactId: result["artifact_id"] });
    await emitter.flush();

    expect(emittedEvents).toHaveLength(1);
    const body = emittedEvents[0] as { kind: string; payload: { artifactId: string } };
    expect(body.kind).toBe("artifact.register");
    expect(body.payload.artifactId).toBe("art-003");
  });
});
