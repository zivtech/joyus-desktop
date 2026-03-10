import { describe, expect, it } from "vitest";

import type { FetchLike, FetchLikeResponse } from "../src/controlPlaneContracts";
import type { SnapshotManifest } from "../src/handoffTypes";
import { HandoffError } from "../src/handoffTypes";
import {
  completeHandoff,
  getHandoffStatus,
  initiateHandoff,
  pollHandoffStatus,
  validateCompleteResponse,
  validateInitiateResponse,
  validateStatusResponse
} from "../src/handoffContracts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Valid base64-encoded 32-byte key (32 zero bytes)
const VALID_PUBLIC_KEY = Buffer.alloc(32).toString("base64");

function makeManifest(overrides?: Partial<SnapshotManifest>): SnapshotManifest {
  return {
    snapshot_id: "snap-1",
    total_size_bytes: 10240,
    chunk_count: 2,
    chunk_size_bytes: 5242880,
    artifact_count: 1,
    artifacts: [
      {
        artifact_id: "art-1",
        content_hash: "sha256-abc",
        size_bytes: 1024,
        content_type: "application/json"
      }
    ],
    schema_version: "1.0",
    ...overrides
  };
}

function makeValidInitiateResponse(artifactCount = 1): Record<string, unknown> {
  const urls: Array<{ artifact_id: string; upload_url: string }> = [];
  for (let i = 0; i < artifactCount; i++) {
    urls.push({ artifact_id: `art-${i + 1}`, upload_url: `https://upload.example.com/art-${i + 1}` });
  }
  return {
    handoff_id: "h-1",
    cloud_public_key: VALID_PUBLIC_KEY,
    manifest_upload_url: "https://upload.example.com/manifest",
    artifact_upload_urls: urls,
    expires_at: "2026-03-10T14:00:00.000Z"
  };
}

function makeValidReceipt(status: "completed" | "failed" = "completed"): Record<string, unknown> {
  return {
    handoff_id: "h-1",
    cloud_session_id: "cs-1",
    status,
    completed_at: "2026-03-10T14:00:00.000Z",
    ...(status === "failed" ? { error: "Cloud rejected handoff" } : { pickup_url: "https://cloud.example.com/session/cs-1" })
  };
}

function makeValidStatusResponse(
  state: string = "transferring",
  extra?: Record<string, unknown>
): Record<string, unknown> {
  return {
    handoff_id: "h-1",
    state,
    chunks_received: 1,
    chunks_total: 2,
    artifacts_received: 0,
    artifacts_total: 1,
    ...extra
  };
}

function mcpFetchLike(responsePayload: unknown): FetchLike {
  return async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        result: {
          content: [{ type: "text", text: JSON.stringify(responsePayload) }]
        }
      };
    },
    async text() {
      return "";
    }
  });
}

function mcpFetchLikeSequence(payloads: unknown[]): FetchLike {
  let index = 0;
  return async () => ({
    ok: true,
    status: 200,
    async json() {
      const payload = payloads[index++];
      return {
        result: {
          content: [{ type: "text", text: JSON.stringify(payload) }]
        }
      };
    },
    async text() {
      return "";
    }
  });
}

const BASE_CONFIG = { baseUrl: "https://cp.example.com", bearerToken: "tok-1" };

// ---------------------------------------------------------------------------
// validateInitiateResponse
// ---------------------------------------------------------------------------

describe("validateInitiateResponse", () => {
  it("accepts a valid initiate response", () => {
    const result = validateInitiateResponse(makeValidInitiateResponse(), 1);
    expect(result.handoff_id).toBe("h-1");
    expect(result.cloud_public_key).toBe(VALID_PUBLIC_KEY);
    expect(result.manifest_upload_url).toBe("https://upload.example.com/manifest");
    expect(result.artifact_upload_urls).toHaveLength(1);
    expect(result.expires_at).toBe("2026-03-10T14:00:00.000Z");
  });

  it("accepts extra fields for forward compatibility", () => {
    const data = { ...makeValidInitiateResponse(), new_field: "future" };
    const result = validateInitiateResponse(data, 1);
    expect(result.handoff_id).toBe("h-1");
  });

  it("rejects null input", () => {
    expect(() => validateInitiateResponse(null, 0)).toThrow(HandoffError);
    expect(() => validateInitiateResponse(null, 0)).toThrow("expected object");
  });

  it("rejects non-object input", () => {
    expect(() => validateInitiateResponse("string", 0)).toThrow("expected object");
  });

  it("rejects missing handoff_id", () => {
    const data = makeValidInitiateResponse();
    delete data.handoff_id;
    expect(() => validateInitiateResponse(data, 1)).toThrow("handoff_id");
  });

  it("rejects empty handoff_id", () => {
    const data = { ...makeValidInitiateResponse(), handoff_id: "" };
    expect(() => validateInitiateResponse(data, 1)).toThrow("handoff_id");
  });

  it("rejects missing cloud_public_key", () => {
    const data = makeValidInitiateResponse();
    delete data.cloud_public_key;
    expect(() => validateInitiateResponse(data, 1)).toThrow("cloud_public_key");
  });

  it("rejects empty cloud_public_key", () => {
    const data = { ...makeValidInitiateResponse(), cloud_public_key: "" };
    expect(() => validateInitiateResponse(data, 1)).toThrow("cloud_public_key");
  });

  it("rejects cloud_public_key that is not valid base64 of 32 bytes", () => {
    const data = { ...makeValidInitiateResponse(), cloud_public_key: "not-valid-base64!!!" };
    expect(() => validateInitiateResponse(data, 1)).toThrow("base64-encoded 32 bytes");
  });

  it("rejects cloud_public_key that decodes to wrong length", () => {
    // 16 bytes instead of 32
    const shortKey = Buffer.alloc(16).toString("base64");
    const data = { ...makeValidInitiateResponse(), cloud_public_key: shortKey };
    expect(() => validateInitiateResponse(data, 1)).toThrow("base64-encoded 32 bytes");
  });

  it("rejects missing manifest_upload_url", () => {
    const data = makeValidInitiateResponse();
    delete data.manifest_upload_url;
    expect(() => validateInitiateResponse(data, 1)).toThrow("manifest_upload_url");
  });

  it("rejects empty manifest_upload_url", () => {
    const data = { ...makeValidInitiateResponse(), manifest_upload_url: "" };
    expect(() => validateInitiateResponse(data, 1)).toThrow("manifest_upload_url");
  });

  it("rejects non-array artifact_upload_urls", () => {
    const data = { ...makeValidInitiateResponse(), artifact_upload_urls: "not-array" };
    expect(() => validateInitiateResponse(data, 1)).toThrow("artifact_upload_urls");
  });

  it("rejects artifact_upload_urls entries missing artifact_id", () => {
    const data = {
      ...makeValidInitiateResponse(),
      artifact_upload_urls: [{ upload_url: "https://upload.example.com/art-1" }]
    };
    expect(() => validateInitiateResponse(data, 1)).toThrow("artifact_id and upload_url");
  });

  it("rejects artifact_upload_urls entries missing upload_url", () => {
    const data = {
      ...makeValidInitiateResponse(),
      artifact_upload_urls: [{ artifact_id: "art-1" }]
    };
    expect(() => validateInitiateResponse(data, 1)).toThrow("artifact_id and upload_url");
  });

  it("rejects null entries in artifact_upload_urls", () => {
    const data = {
      ...makeValidInitiateResponse(),
      artifact_upload_urls: [null]
    };
    expect(() => validateInitiateResponse(data, 1)).toThrow("artifact_id and upload_url");
  });

  it("rejects artifact_upload_urls count mismatch", () => {
    const data = makeValidInitiateResponse();
    // Data has 1 URL but we expect 2
    expect(() => validateInitiateResponse(data, 2)).toThrow("does not match manifest artifact_count");
  });

  it("rejects missing expires_at", () => {
    const data = makeValidInitiateResponse();
    delete data.expires_at;
    expect(() => validateInitiateResponse(data, 1)).toThrow("expires_at");
  });

  it("rejects empty expires_at", () => {
    const data = { ...makeValidInitiateResponse(), expires_at: "" };
    expect(() => validateInitiateResponse(data, 1)).toThrow("expires_at");
  });
});

// ---------------------------------------------------------------------------
// validateCompleteResponse
// ---------------------------------------------------------------------------

describe("validateCompleteResponse", () => {
  it("accepts a valid completed receipt", () => {
    const result = validateCompleteResponse(makeValidReceipt("completed"));
    expect(result.handoff_id).toBe("h-1");
    expect(result.cloud_session_id).toBe("cs-1");
    expect(result.status).toBe("completed");
    expect(result.pickup_url).toBe("https://cloud.example.com/session/cs-1");
    expect(result.completed_at).toBe("2026-03-10T14:00:00.000Z");
  });

  it("accepts a valid failed receipt", () => {
    const result = validateCompleteResponse(makeValidReceipt("failed"));
    expect(result.status).toBe("failed");
    expect(result.error).toBe("Cloud rejected handoff");
  });

  it("accepts extra fields for forward compatibility", () => {
    const data = { ...makeValidReceipt(), future_field: 42 };
    const result = validateCompleteResponse(data);
    expect(result.handoff_id).toBe("h-1");
  });

  it("rejects null input", () => {
    expect(() => validateCompleteResponse(null)).toThrow(HandoffError);
    expect(() => validateCompleteResponse(null)).toThrow("expected object");
  });

  it("rejects non-object input", () => {
    expect(() => validateCompleteResponse(42)).toThrow("expected object");
  });

  it("rejects missing handoff_id", () => {
    const data = makeValidReceipt();
    delete data.handoff_id;
    expect(() => validateCompleteResponse(data)).toThrow("handoff_id");
  });

  it("rejects empty handoff_id", () => {
    expect(() => validateCompleteResponse({ ...makeValidReceipt(), handoff_id: "" })).toThrow("handoff_id");
  });

  it("rejects missing cloud_session_id", () => {
    const data = makeValidReceipt();
    delete data.cloud_session_id;
    expect(() => validateCompleteResponse(data)).toThrow("cloud_session_id");
  });

  it("rejects empty cloud_session_id", () => {
    expect(() => validateCompleteResponse({ ...makeValidReceipt(), cloud_session_id: "" })).toThrow("cloud_session_id");
  });

  it("rejects invalid status values", () => {
    expect(() => validateCompleteResponse({ ...makeValidReceipt(), status: "pending" })).toThrow("status");
  });

  it("rejects missing completed_at", () => {
    const data = makeValidReceipt();
    delete data.completed_at;
    expect(() => validateCompleteResponse(data)).toThrow("completed_at");
  });

  it("rejects empty completed_at", () => {
    expect(() => validateCompleteResponse({ ...makeValidReceipt(), completed_at: "" })).toThrow("completed_at");
  });

  it("rejects non-string pickup_url", () => {
    expect(() => validateCompleteResponse({ ...makeValidReceipt(), pickup_url: 123 })).toThrow("pickup_url");
  });

  it("rejects non-string error", () => {
    expect(() => validateCompleteResponse({ ...makeValidReceipt(), error: 123 })).toThrow("error");
  });

  it("omits pickup_url when not present", () => {
    const data = makeValidReceipt("failed");
    const result = validateCompleteResponse(data);
    expect(result).not.toHaveProperty("pickup_url");
  });

  it("omits error when not present", () => {
    const data = makeValidReceipt("completed");
    const result = validateCompleteResponse(data);
    expect(result).not.toHaveProperty("error");
  });
});

// ---------------------------------------------------------------------------
// validateStatusResponse
// ---------------------------------------------------------------------------

describe("validateStatusResponse", () => {
  it("accepts a valid status response", () => {
    const result = validateStatusResponse(makeValidStatusResponse());
    expect(result.handoff_id).toBe("h-1");
    expect(result.state).toBe("transferring");
    expect(result.chunks_received).toBe(1);
    expect(result.chunks_total).toBe(2);
    expect(result.artifacts_received).toBe(0);
    expect(result.artifacts_total).toBe(1);
  });

  it("accepts all valid state values", () => {
    for (const state of ["initiated", "authorizing", "encrypting", "transferring", "completed", "failed"]) {
      const result = validateStatusResponse(makeValidStatusResponse(state));
      expect(result.state).toBe(state);
    }
  });

  it("accepts optional error field", () => {
    const result = validateStatusResponse(makeValidStatusResponse("failed", { error: "timeout" }));
    expect(result.error).toBe("timeout");
  });

  it("omits error when not present", () => {
    const result = validateStatusResponse(makeValidStatusResponse());
    expect(result).not.toHaveProperty("error");
  });

  it("accepts extra fields for forward compatibility", () => {
    const data = { ...makeValidStatusResponse(), future: true };
    const result = validateStatusResponse(data);
    expect(result.handoff_id).toBe("h-1");
  });

  it("rejects null input", () => {
    expect(() => validateStatusResponse(null)).toThrow(HandoffError);
    expect(() => validateStatusResponse(null)).toThrow("expected object");
  });

  it("rejects non-object input", () => {
    expect(() => validateStatusResponse(false)).toThrow("expected object");
  });

  it("rejects missing handoff_id", () => {
    const data = makeValidStatusResponse();
    delete data.handoff_id;
    expect(() => validateStatusResponse(data)).toThrow("handoff_id");
  });

  it("rejects empty handoff_id", () => {
    expect(() => validateStatusResponse({ ...makeValidStatusResponse(), handoff_id: "" })).toThrow("handoff_id");
  });

  it("rejects invalid state value", () => {
    expect(() => validateStatusResponse({ ...makeValidStatusResponse(), state: "pending" })).toThrow("state");
  });

  it("rejects non-string state", () => {
    expect(() => validateStatusResponse({ ...makeValidStatusResponse(), state: 123 })).toThrow("state");
  });

  it("rejects missing chunks_received", () => {
    const data = makeValidStatusResponse();
    delete data.chunks_received;
    expect(() => validateStatusResponse(data)).toThrow("chunks_received");
  });

  it("rejects missing chunks_total", () => {
    const data = makeValidStatusResponse();
    delete data.chunks_total;
    expect(() => validateStatusResponse(data)).toThrow("chunks_total");
  });

  it("rejects missing artifacts_received", () => {
    const data = makeValidStatusResponse();
    delete data.artifacts_received;
    expect(() => validateStatusResponse(data)).toThrow("artifacts_received");
  });

  it("rejects missing artifacts_total", () => {
    const data = makeValidStatusResponse();
    delete data.artifacts_total;
    expect(() => validateStatusResponse(data)).toThrow("artifacts_total");
  });

  it("rejects non-string error", () => {
    expect(() => validateStatusResponse({ ...makeValidStatusResponse(), error: 42 })).toThrow("error");
  });
});

// ---------------------------------------------------------------------------
// initiateHandoff
// ---------------------------------------------------------------------------

describe("initiateHandoff", () => {
  it("calls initiate_handoff through MCP and returns parsed response", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const manifest = makeManifest();

    const fetchLike: FetchLike = async (url: string, init: { body?: string }) => {
      requests.push({ url, body: init.body ? JSON.parse(init.body) : null });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            result: {
              content: [{ type: "text", text: JSON.stringify(makeValidInitiateResponse()) }]
            }
          };
        },
        async text() {
          return "";
        }
      };
    };

    const result = await initiateHandoff(fetchLike, BASE_CONFIG, {
      manifest,
      policy_token: "ptk-1",
      session_id: "sess-1",
      tenant_id: "tenant-a",
      workspace_id: "ws-1"
    });

    expect(result.handoff_id).toBe("h-1");
    expect(result.cloud_public_key).toBe(VALID_PUBLIC_KEY);
    expect(result.manifest_upload_url).toBe("https://upload.example.com/manifest");
    expect(result.artifact_upload_urls).toHaveLength(1);
    expect(result.expires_at).toBe("2026-03-10T14:00:00.000Z");

    expect(requests[0]?.url).toBe("https://cp.example.com/mcp");
    expect(requests[0]?.body).toEqual({
      jsonrpc: "2.0",
      id: "cp-tool-1",
      method: "tools/call",
      params: {
        name: "initiate_handoff",
        arguments: {
          session_id: "sess-1",
          tenant_id: "tenant-a",
          workspace_id: "ws-1",
          policy_token: "ptk-1",
          manifest
        }
      }
    });
  });

  it("throws INVALID_RESPONSE for missing handoff_id", async () => {
    const data = makeValidInitiateResponse();
    delete data.handoff_id;

    await expect(
      initiateHandoff(mcpFetchLike(data), BASE_CONFIG, {
        manifest: makeManifest(),
        policy_token: "ptk-1",
        session_id: "sess-1",
        tenant_id: "tenant-a",
        workspace_id: "ws-1"
      })
    ).rejects.toThrow(HandoffError);
  });

  it("throws INVALID_RESPONSE for invalid cloud_public_key", async () => {
    const data = { ...makeValidInitiateResponse(), cloud_public_key: "bad-key" };

    await expect(
      initiateHandoff(mcpFetchLike(data), BASE_CONFIG, {
        manifest: makeManifest(),
        policy_token: "ptk-1",
        session_id: "sess-1",
        tenant_id: "tenant-a",
        workspace_id: "ws-1"
      })
    ).rejects.toThrow("base64-encoded 32 bytes");
  });

  it("throws INVALID_RESPONSE for artifact_upload_urls count mismatch", async () => {
    // Manifest has artifact_count=1 but response has 2 URLs
    const data = makeValidInitiateResponse(2);

    await expect(
      initiateHandoff(mcpFetchLike(data), BASE_CONFIG, {
        manifest: makeManifest({ artifact_count: 1 }),
        policy_token: "ptk-1",
        session_id: "sess-1",
        tenant_id: "tenant-a",
        workspace_id: "ws-1"
      })
    ).rejects.toThrow("does not match manifest artifact_count");
  });

  it("propagates MCP transport errors", async () => {
    const fetchLike: FetchLike = async () => ({
      ok: false,
      status: 502,
      async json() {
        return {};
      },
      async text() {
        return "bad gateway";
      }
    });

    await expect(
      initiateHandoff(fetchLike, BASE_CONFIG, {
        manifest: makeManifest(),
        policy_token: "ptk-1",
        session_id: "sess-1",
        tenant_id: "tenant-a",
        workspace_id: "ws-1"
      })
    ).rejects.toThrow("MCP request failed (502): bad gateway");
  });
});

// ---------------------------------------------------------------------------
// completeHandoff
// ---------------------------------------------------------------------------

describe("completeHandoff", () => {
  it("calls complete_handoff through MCP and returns receipt", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];

    const fetchLike: FetchLike = async (url: string, init: { body?: string }) => {
      requests.push({ url, body: init.body ? JSON.parse(init.body) : null });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            result: {
              content: [{ type: "text", text: JSON.stringify(makeValidReceipt("completed")) }]
            }
          };
        },
        async text() {
          return "";
        }
      };
    };

    const result = await completeHandoff(fetchLike, BASE_CONFIG, {
      handoff_id: "h-1",
      ephemeral_public_key: VALID_PUBLIC_KEY
    });

    expect(result.handoff_id).toBe("h-1");
    expect(result.cloud_session_id).toBe("cs-1");
    expect(result.status).toBe("completed");
    expect(result.pickup_url).toBe("https://cloud.example.com/session/cs-1");

    expect(requests[0]?.body).toEqual({
      jsonrpc: "2.0",
      id: "cp-tool-1",
      method: "tools/call",
      params: {
        name: "complete_handoff",
        arguments: {
          handoff_id: "h-1",
          ephemeral_public_key: VALID_PUBLIC_KEY
        }
      }
    });
  });

  it("throws HANDOFF_REJECTED for failed receipt with error message", async () => {
    const receipt = makeValidReceipt("failed");

    try {
      await completeHandoff(mcpFetchLike(receipt), BASE_CONFIG, {
        handoff_id: "h-1",
        ephemeral_public_key: VALID_PUBLIC_KEY
      });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(HandoffError);
      expect((err as HandoffError).code).toBe("HANDOFF_REJECTED");
      expect((err as HandoffError).message).toBe("Cloud rejected handoff");
    }
  });

  it("throws HANDOFF_REJECTED with default message when error field is absent", async () => {
    const receipt = {
      handoff_id: "h-1",
      cloud_session_id: "cs-1",
      status: "failed",
      completed_at: "2026-03-10T14:00:00.000Z"
    };

    try {
      await completeHandoff(mcpFetchLike(receipt), BASE_CONFIG, {
        handoff_id: "h-1",
        ephemeral_public_key: VALID_PUBLIC_KEY
      });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(HandoffError);
      expect((err as HandoffError).code).toBe("HANDOFF_REJECTED");
      expect((err as HandoffError).message).toBe("Handoff was rejected by the cloud");
    }
  });

  it("throws INVALID_RESPONSE for missing fields", async () => {
    const data = { handoff_id: "h-1" };

    await expect(
      completeHandoff(mcpFetchLike(data), BASE_CONFIG, {
        handoff_id: "h-1",
        ephemeral_public_key: VALID_PUBLIC_KEY
      })
    ).rejects.toThrow(HandoffError);
  });

  it("propagates MCP transport errors", async () => {
    const fetchLike: FetchLike = async () => ({
      ok: false,
      status: 500,
      async json() {
        return {};
      },
      async text() {
        return "internal error";
      }
    });

    await expect(
      completeHandoff(fetchLike, BASE_CONFIG, {
        handoff_id: "h-1",
        ephemeral_public_key: VALID_PUBLIC_KEY
      })
    ).rejects.toThrow("MCP request failed (500): internal error");
  });
});

// ---------------------------------------------------------------------------
// getHandoffStatus
// ---------------------------------------------------------------------------

describe("getHandoffStatus", () => {
  it("calls handoff_status through MCP and returns parsed status", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];

    const fetchLike: FetchLike = async (url: string, init: { body?: string }) => {
      requests.push({ url, body: init.body ? JSON.parse(init.body) : null });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            result: {
              content: [{ type: "text", text: JSON.stringify(makeValidStatusResponse("transferring")) }]
            }
          };
        },
        async text() {
          return "";
        }
      };
    };

    const result = await getHandoffStatus(fetchLike, BASE_CONFIG, "h-1");

    expect(result.handoff_id).toBe("h-1");
    expect(result.state).toBe("transferring");
    expect(result.chunks_received).toBe(1);
    expect(result.chunks_total).toBe(2);

    expect(requests[0]?.body).toEqual({
      jsonrpc: "2.0",
      id: "cp-tool-1",
      method: "tools/call",
      params: {
        name: "handoff_status",
        arguments: { handoff_id: "h-1" }
      }
    });
  });

  it("throws INVALID_RESPONSE for invalid state value", async () => {
    const data = { ...makeValidStatusResponse(), state: "unknown" };

    await expect(getHandoffStatus(mcpFetchLike(data), BASE_CONFIG, "h-1")).rejects.toThrow("state");
  });

  it("propagates MCP transport errors", async () => {
    const fetchLike: FetchLike = async () => ({
      ok: false,
      status: 503,
      async json() {
        return {};
      },
      async text() {
        return "unavailable";
      }
    });

    await expect(getHandoffStatus(fetchLike, BASE_CONFIG, "h-1")).rejects.toThrow(
      "MCP request failed (503): unavailable"
    );
  });
});

// ---------------------------------------------------------------------------
// pollHandoffStatus
// ---------------------------------------------------------------------------

describe("pollHandoffStatus", () => {
  it("yields status until a final state is reached (completed)", async () => {
    const payloads = [
      makeValidStatusResponse("transferring"),
      makeValidStatusResponse("transferring"),
      makeValidStatusResponse("completed")
    ];

    const results = [];
    for await (const status of pollHandoffStatus(
      mcpFetchLikeSequence(payloads),
      BASE_CONFIG,
      "h-1",
      { interval: 0, timeout: 5000 }
    )) {
      results.push(status);
    }

    expect(results).toHaveLength(3);
    expect(results[0]?.state).toBe("transferring");
    expect(results[1]?.state).toBe("transferring");
    expect(results[2]?.state).toBe("completed");
  });

  it("yields status until a final state is reached (failed)", async () => {
    const payloads = [makeValidStatusResponse("failed", { error: "upload timeout" })];

    const results = [];
    for await (const status of pollHandoffStatus(
      mcpFetchLikeSequence(payloads),
      BASE_CONFIG,
      "h-1",
      { interval: 0, timeout: 5000 }
    )) {
      results.push(status);
    }

    expect(results).toHaveLength(1);
    expect(results[0]?.state).toBe("failed");
    expect(results[0]?.error).toBe("upload timeout");
  });

  it("throws TIMEOUT after timeout elapses", async () => {
    // Always return non-final state
    const fetchLike: FetchLike = async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          result: {
            content: [{ type: "text", text: JSON.stringify(makeValidStatusResponse("transferring")) }]
          }
        };
      },
      async text() {
        return "";
      }
    });

    const results = [];
    try {
      for await (const status of pollHandoffStatus(fetchLike, BASE_CONFIG, "h-1", {
        interval: 0,
        timeout: 1
      })) {
        results.push(status);
      }
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(HandoffError);
      expect((err as HandoffError).code).toBe("TIMEOUT");
    }

    // Should have yielded at least one result before timing out
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("throws AbortError when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const results = [];
    try {
      for await (const status of pollHandoffStatus(
        mcpFetchLike(makeValidStatusResponse("transferring")),
        BASE_CONFIG,
        "h-1",
        { interval: 0, timeout: 5000, signal: controller.signal }
      )) {
        results.push(status);
      }
      expect.fail("Should have thrown");
    } catch (err) {
      expect((err as DOMException).name).toBe("AbortError");
    }
  });

  it("throws AbortError when signal is aborted during polling", async () => {
    const controller = new AbortController();

    // Always return non-final state
    let callCount = 0;
    const fetchLike: FetchLike = async () => {
      callCount++;
      if (callCount >= 2) {
        controller.abort();
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            result: {
              content: [{ type: "text", text: JSON.stringify(makeValidStatusResponse("transferring")) }]
            }
          };
        },
        async text() {
          return "";
        }
      };
    };

    const results = [];
    try {
      for await (const status of pollHandoffStatus(fetchLike, BASE_CONFIG, "h-1", {
        interval: 0,
        timeout: 60000,
        signal: controller.signal
      })) {
        results.push(status);
      }
      expect.fail("Should have thrown");
    } catch (err) {
      expect((err as DOMException).name).toBe("AbortError");
    }
  });

  it("uses default interval and timeout when options are omitted", async () => {
    // Just test that it works when options are undefined — use a final state immediately
    const payloads = [makeValidStatusResponse("completed")];

    const results = [];
    for await (const status of pollHandoffStatus(
      mcpFetchLikeSequence(payloads),
      BASE_CONFIG,
      "h-1"
    )) {
      results.push(status);
    }

    expect(results).toHaveLength(1);
    expect(results[0]?.state).toBe("completed");
  });
});
