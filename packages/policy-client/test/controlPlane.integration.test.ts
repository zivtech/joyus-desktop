import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestControlPlane, type HarnessHandle } from "./fixtures/control-plane-harness";
import { createControlPlaneClient, loadConfigFromEnv } from "../src/controlPlaneClient";
import {
  requestPolicyDecision,
  buildPolicyDecideRequest,
  requestWorkspace,
  getArtifactProvenance,
} from "../src/controlPlaneContracts";
import type { FetchLike } from "../src/controlPlaneContracts";
import {
  initiateHandoff,
  completeHandoff,
  getHandoffStatus,
  pollHandoffStatus,
} from "../src/handoffContracts";
import type { SnapshotManifest } from "../src/handoffTypes";

// ---------------------------------------------------------------------------
// Harness lifecycle
// ---------------------------------------------------------------------------

let harness: HarnessHandle;
let fetchClient: FetchLike;
let baseUrl: string;
const bearerToken = "integration-test-token";

beforeAll(async () => {
  harness = await startTestControlPlane({ port: 0 });
  baseUrl = harness.baseUrl;

  // Build a real client with short timeouts for test speed
  fetchClient = createControlPlaneClient(
    {
      baseUrl,
      bearerToken,
      mtlsCertPath: undefined,
      mtlsKeyPath: undefined,
      mtlsCaPath: undefined,
      requestTimeoutMs: 5000,
      retryMaxAttempts: 2,
      retryBaseDelayMs: 50,
    },
    { fetchFn: globalThis.fetch },
  );
});

afterAll(async () => {
  await harness.close();
});

// ---------------------------------------------------------------------------
// Test manifest fixture
// ---------------------------------------------------------------------------

function makeTestManifest(artifactCount = 0): SnapshotManifest {
  return {
    snapshot_id: "snap-integration-001",
    total_size_bytes: 1024,
    chunk_count: 1,
    chunk_size_bytes: 5_242_880,
    artifact_count: artifactCount,
    artifacts: Array.from({ length: artifactCount }, (_, i) => ({
      artifact_id: `art-${i}`,
      content_hash: "abc123",
      size_bytes: 256,
      content_type: "application/octet-stream",
    })),
    schema_version: "1.0",
  };
}

// ---------------------------------------------------------------------------
// Policy decision (verify_before_action)
// ---------------------------------------------------------------------------

describe("verify_before_action (integration)", () => {
  it("returns allow decision through the real client→server loop", async () => {
    const request = buildPolicyDecideRequest({
      actionName: "session.handoff",
      riskLevel: "medium",
      tenantId: "tenant-1",
      sessionId: "session-1",
      workspaceId: "ws-1",
    });

    const result = await requestPolicyDecision(fetchClient, {
      baseUrl,
      bearerToken,
      request,
    });

    expect(result.decision).toBe("allow");
    expect(result.reason).toContain("session.handoff");
    expect(result.token).toContain(".");
    expect(result.jti).toBeTruthy();
    expect(result.risk_level).toBe("medium");
  });

  it("returns deny when configured per-action", async () => {
    harness.state.policyDecisions.set("dangerous.action", "deny");

    const request = buildPolicyDecideRequest({
      actionName: "dangerous.action",
      riskLevel: "high",
      tenantId: "tenant-1",
      sessionId: "session-1",
    });

    const result = await requestPolicyDecision(fetchClient, {
      baseUrl,
      bearerToken,
      request,
    });

    expect(result.decision).toBe("deny");
    harness.state.policyDecisions.delete("dangerous.action");
  });

  it("returns escalate when configured per-action", async () => {
    harness.state.policyDecisions.set("risky.action", "escalate");

    const request = buildPolicyDecideRequest({
      actionName: "risky.action",
      riskLevel: "medium",
      tenantId: "tenant-1",
      sessionId: "session-1",
    });

    const result = await requestPolicyDecision(fetchClient, {
      baseUrl,
      bearerToken,
      request,
    });

    expect(result.decision).toBe("escalate");
    harness.state.policyDecisions.delete("risky.action");
  });
});

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

describe("request_workspace (integration)", () => {
  it("returns a valid workspace record", async () => {
    const result = await requestWorkspace(fetchClient, {
      baseUrl,
      bearerToken,
      tenantId: "tenant-1",
      mode: "local",
      label: "dev",
    });

    expect(result.workspace_id).toMatch(/^ws-/);
    expect(result.tenant_id).toBe("tenant-1");
    expect(result.mode).toBe("local");
    expect(result.status).toBe("ready");
  });
});

// ---------------------------------------------------------------------------
// Artifact provenance
// ---------------------------------------------------------------------------

describe("get_provenance (integration)", () => {
  it("returns provenance for an artifact", async () => {
    const result = await getArtifactProvenance(fetchClient, {
      baseUrl,
      bearerToken,
      artifactId: "art-001",
    });

    expect(result["artifact_id"]).toBe("art-001");
    expect(result["origin"]).toBe("test-harness");
  });
});

// ---------------------------------------------------------------------------
// Handoff: initiate → status → complete
// ---------------------------------------------------------------------------

describe("handoff lifecycle (integration)", () => {
  it("initiate_handoff returns valid response with real X25519 key", async () => {
    const manifest = makeTestManifest(2);

    const result = await initiateHandoff(fetchClient, { baseUrl, bearerToken }, {
      manifest,
      policy_token: "tok",
      session_id: "sess-1",
      tenant_id: "tenant-1",
      workspace_id: "ws-1",
    });

    expect(result.handoff_id).toMatch(/^hoff-/);
    expect(result.manifest_upload_url).toContain("/session-handoff/");
    expect(result.artifact_upload_urls).toHaveLength(2);
    expect(result.expires_at).toBeTruthy();

    // Validate cloud_public_key is base64-encoded 32 bytes
    const keyBuf = Buffer.from(result.cloud_public_key, "base64");
    expect(keyBuf.length).toBe(32);

    // Verify state was recorded
    const record = harness.state.handoffs.get(result.handoff_id);
    expect(record).toBeDefined();
    expect(record!.state).toBe("initiated");
  });

  it("handoff_status returns current state", async () => {
    const manifest = makeTestManifest(0);
    const initResult = await initiateHandoff(fetchClient, { baseUrl, bearerToken }, {
      manifest,
      policy_token: "tok",
      session_id: "sess-2",
      tenant_id: "tenant-1",
      workspace_id: "ws-1",
    });

    const status = await getHandoffStatus(fetchClient, { baseUrl, bearerToken }, initResult.handoff_id);

    expect(status.handoff_id).toBe(initResult.handoff_id);
    expect(status.state).toBe("initiated");
    expect(status.chunks_total).toBe(1);
    expect(status.artifacts_total).toBe(0);
  });

  it("complete_handoff returns receipt with cloud session", async () => {
    const manifest = makeTestManifest(0);
    const initResult = await initiateHandoff(fetchClient, { baseUrl, bearerToken }, {
      manifest,
      policy_token: "tok",
      session_id: "sess-3",
      tenant_id: "tenant-1",
      workspace_id: "ws-1",
    });

    const receipt = await completeHandoff(fetchClient, { baseUrl, bearerToken }, {
      handoff_id: initResult.handoff_id,
      ephemeral_public_key: Buffer.alloc(32).toString("base64"),
    });

    expect(receipt.handoff_id).toBe(initResult.handoff_id);
    expect(receipt.status).toBe("completed");
    expect(receipt.cloud_session_id).toMatch(/^cloud-/);
    expect(receipt.pickup_url).toContain(receipt.cloud_session_id);
    expect(receipt.completed_at).toBeTruthy();

    // State updated in harness
    const record = harness.state.handoffs.get(initResult.handoff_id);
    expect(record!.state).toBe("completed");
  });

  it("handoff_status returns failed for unknown handoff_id", async () => {
    const status = await getHandoffStatus(fetchClient, { baseUrl, bearerToken }, "nonexistent");

    expect(status.state).toBe("failed");
    expect(status.error).toContain("Unknown handoff");
  });

  it("full lifecycle: initiate → poll → complete", async () => {
    const manifest = makeTestManifest(1);
    const initResult = await initiateHandoff(fetchClient, { baseUrl, bearerToken }, {
      manifest,
      policy_token: "tok",
      session_id: "sess-lifecycle",
      tenant_id: "tenant-1",
      workspace_id: "ws-1",
    });

    // Simulate upload progress by mutating harness state
    const record = harness.state.handoffs.get(initResult.handoff_id)!;
    record.state = "transferring";
    record.chunks_received = 1;
    record.artifacts_received = 1;

    // Poll — should see transferring, then complete it
    const statuses: string[] = [];
    const controller = new AbortController();

    // After collecting one status, complete the handoff
    for await (const status of pollHandoffStatus(
      fetchClient,
      { baseUrl, bearerToken },
      initResult.handoff_id,
      { interval: 50, timeout: 5000, signal: controller.signal },
    )) {
      statuses.push(status.state);
      if (status.state === "transferring") {
        record.state = "completed";
      }
      if (status.state === "completed") {
        break;
      }
    }

    expect(statuses).toContain("transferring");
    expect(statuses).toContain("completed");
  });
});

// ---------------------------------------------------------------------------
// tus upload stubs
// ---------------------------------------------------------------------------

describe("tus upload stubs (integration)", () => {
  it("HEAD returns upload offset", async () => {
    const manifest = makeTestManifest(0);
    const initResult = await initiateHandoff(fetchClient, { baseUrl, bearerToken }, {
      manifest,
      policy_token: "tok",
      session_id: "sess-tus",
      tenant_id: "tenant-1",
      workspace_id: "ws-1",
    });

    const resp = await fetch(`${baseUrl}/session-handoff/${initResult.handoff_id}/upload`, {
      method: "HEAD",
    });

    expect(resp.status).toBe(200);
    expect(resp.headers.get("upload-offset")).toBe("0");
    expect(resp.headers.get("tus-resumable")).toBe("1.0.0");
  });

  it("PATCH accepts chunk data and updates offset", async () => {
    const manifest = makeTestManifest(0);
    const initResult = await initiateHandoff(fetchClient, { baseUrl, bearerToken }, {
      manifest,
      policy_token: "tok",
      session_id: "sess-tus-patch",
      tenant_id: "tenant-1",
      workspace_id: "ws-1",
    });

    const chunkData = Buffer.alloc(128, 0xab);
    const resp = await fetch(`${baseUrl}/session-handoff/${initResult.handoff_id}/upload`, {
      method: "PATCH",
      headers: {
        "content-type": "application/offset+octet-stream",
        "upload-offset": "0",
        "tus-resumable": "1.0.0",
      },
      body: chunkData,
    });

    expect(resp.status).toBe(204);
    expect(resp.headers.get("tus-resumable")).toBe("1.0.0");

    // State updated
    const record = harness.state.handoffs.get(initResult.handoff_id)!;
    expect(record.chunks_received).toBe(1);
    expect(record.state).toBe("transferring");
  });

  it("PATCH to artifact endpoint increments artifacts_received", async () => {
    const manifest = makeTestManifest(1);
    const initResult = await initiateHandoff(fetchClient, { baseUrl, bearerToken }, {
      manifest,
      policy_token: "tok",
      session_id: "sess-tus-art",
      tenant_id: "tenant-1",
      workspace_id: "ws-1",
    });

    const artData = Buffer.alloc(64, 0xcd);
    const resp = await fetch(
      `${baseUrl}/session-handoff/${initResult.handoff_id}/artifacts/art-0`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/offset+octet-stream",
          "upload-offset": "0",
          "tus-resumable": "1.0.0",
        },
        body: artData,
      },
    );

    expect(resp.status).toBe(204);

    const record = harness.state.handoffs.get(initResult.handoff_id)!;
    expect(record.artifacts_received).toBe(1);
  });

  it("OPTIONS returns tus protocol headers", async () => {
    const manifest = makeTestManifest(0);
    const initResult = await initiateHandoff(fetchClient, { baseUrl, bearerToken }, {
      manifest,
      policy_token: "tok",
      session_id: "sess-tus-opts",
      tenant_id: "tenant-1",
      workspace_id: "ws-1",
    });

    const resp = await fetch(`${baseUrl}/session-handoff/${initResult.handoff_id}/upload`, {
      method: "OPTIONS",
    });

    expect(resp.status).toBe(204);
    expect(resp.headers.get("tus-resumable")).toBe("1.0.0");
    expect(resp.headers.get("tus-version")).toBe("1.0.0");
  });
});

// ---------------------------------------------------------------------------
// Tool call logging
// ---------------------------------------------------------------------------

describe("harness tool call log", () => {
  it("records every tool call with args and timestamp", async () => {
    const logBefore = harness.state.toolCallLog.length;

    await requestWorkspace(fetchClient, {
      baseUrl,
      bearerToken,
      tenantId: "log-test",
    });

    const newEntries = harness.state.toolCallLog.slice(logBefore);
    expect(newEntries.length).toBe(1);
    expect(newEntries[0]!.tool).toBe("request_workspace");
    expect(newEntries[0]!.args["tenant_id"]).toBe("log-test");
    expect(typeof newEntries[0]!.timestamp).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("harness error paths", () => {
  it("returns MCP error for unknown tool", async () => {
    const resp = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "err-1",
        method: "tools/call",
        params: { name: "nonexistent_tool", arguments: {} },
      }),
    });

    const body = await resp.json() as Record<string, unknown>;
    expect(body["error"]).toBeDefined();
    const error = body["error"] as Record<string, unknown>;
    expect(error["code"]).toBe(-32601);
  });

  it("returns 400 for malformed JSON", async () => {
    const resp = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });

    expect(resp.status).toBe(400);
  });

  it("returns 404 for unknown path", async () => {
    const resp = await fetch(`${baseUrl}/unknown`);
    expect(resp.status).toBe(404);
  });

  it("health endpoint returns ok", async () => {
    const resp = await fetch(`${baseUrl}/health`);
    const body = await resp.json() as Record<string, unknown>;
    expect(resp.status).toBe(200);
    expect(body["status"]).toBe("ok");
    expect(body["mode"]).toBe("test-harness");
  });
});

// ---------------------------------------------------------------------------
// loadConfigFromEnv integration
// ---------------------------------------------------------------------------

describe("loadConfigFromEnv → real client (integration)", () => {
  it("works with env var override", () => {
    const savedUrl = process.env["JOYUS_API_URL"];
    const savedToken = process.env["JOYUS_API_TOKEN"];

    process.env["JOYUS_API_URL"] = baseUrl;
    process.env["JOYUS_API_TOKEN"] = "env-test-token";

    try {
      const config = loadConfigFromEnv();
      expect(config.baseUrl).toBe(baseUrl);
      expect(config.bearerToken).toBe("env-test-token");

      const client = createControlPlaneClient(config, { fetchFn: globalThis.fetch });
      expect(client).toBeDefined();
    } finally {
      if (savedUrl === undefined) {
        delete process.env["JOYUS_API_URL"];
      } else {
        process.env["JOYUS_API_URL"] = savedUrl;
      }
      if (savedToken === undefined) {
        delete process.env["JOYUS_API_TOKEN"];
      } else {
        process.env["JOYUS_API_TOKEN"] = savedToken;
      }
    }
  });
});
