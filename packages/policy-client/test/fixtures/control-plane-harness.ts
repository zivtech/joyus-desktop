import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { generateEphemeralKeyPair } from "../../src/snapshotEncryption";
import type { HandoffState, SnapshotManifest, HandoffReceipt } from "../../src/handoffTypes";

// ---------------------------------------------------------------------------
// Internal state tracking
// ---------------------------------------------------------------------------

export interface HandoffRecord {
  handoff_id: string;
  session_id: string;
  tenant_id: string;
  workspace_id: string;
  state: HandoffState;
  cloud_public_key: string;
  manifest: SnapshotManifest;
  manifest_upload_url: string;
  artifact_upload_urls: Array<{ artifact_id: string; upload_url: string }>;
  chunks_received: number;
  artifacts_received: number;
  ephemeral_public_key?: string;
  cloud_session_id?: string;
  expires_at: string;
  error?: string;
}

export interface HarnessState {
  handoffs: Map<string, HandoffRecord>;
  policyDecisions: Map<string, "allow" | "deny" | "escalate">;
  toolCallLog: Array<{ tool: string; args: Record<string, unknown>; timestamp: number }>;
}

export interface HarnessHandle {
  baseUrl: string;
  close: () => Promise<void>;
  state: HarnessState;
}

export interface HarnessOptions {
  port?: number;
  defaultPolicyDecision?: "allow" | "deny" | "escalate";
}

// ---------------------------------------------------------------------------
// JWT-shaped token (not cryptographically valid — test only)
// ---------------------------------------------------------------------------

function makeTestToken(): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub: "harness-user",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    jti: randomUUID(),
  })).toString("base64url");
  const sig = Buffer.from("harness-sig").toString("base64url");
  return `${header}.${payload}.${sig}`;
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

function handleVerifyBeforeAction(
  args: Record<string, unknown>,
  state: HarnessState,
  defaultDecision: "allow" | "deny" | "escalate",
): Record<string, unknown> {
  const actionName = String(args["action_name"] ?? "unknown");
  const decision = state.policyDecisions.get(actionName) ?? defaultDecision;

  return {
    decision,
    reason: `Harness: ${decision} for ${actionName}`,
    token: makeTestToken(),
    token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    jti: randomUUID(),
    risk_level: args["risk_level"] ?? "low",
  };
}

function handleInitiateHandoff(
  args: Record<string, unknown>,
  state: HarnessState,
  baseUrl: string,
): Record<string, unknown> {
  const handoffId = `hoff-${randomUUID().slice(0, 8)}`;
  const keyPair = generateEphemeralKeyPair();
  const cloudPublicKeyB64 = keyPair.publicKey.toString("base64");

  const manifest = args["manifest"] as SnapshotManifest;
  const artifacts = manifest?.artifacts ?? [];

  const manifestUploadUrl = `${baseUrl}/session-handoff/${handoffId}/upload`;
  const artifactUploadUrls = artifacts.map((a) => ({
    artifact_id: a.artifact_id,
    upload_url: `${baseUrl}/session-handoff/${handoffId}/artifacts/${a.artifact_id}`,
  }));

  const record: HandoffRecord = {
    handoff_id: handoffId,
    session_id: String(args["session_id"] ?? ""),
    tenant_id: String(args["tenant_id"] ?? ""),
    workspace_id: String(args["workspace_id"] ?? ""),
    state: "initiated",
    cloud_public_key: cloudPublicKeyB64,
    manifest,
    manifest_upload_url: manifestUploadUrl,
    artifact_upload_urls: artifactUploadUrls,
    chunks_received: 0,
    artifacts_received: 0,
    expires_at: new Date(Date.now() + 300_000).toISOString(),
  };

  state.handoffs.set(handoffId, record);

  return {
    handoff_id: handoffId,
    cloud_public_key: cloudPublicKeyB64,
    manifest_upload_url: manifestUploadUrl,
    artifact_upload_urls: artifactUploadUrls,
    expires_at: record.expires_at,
  };
}

function handleCompleteHandoff(
  args: Record<string, unknown>,
  state: HarnessState,
): Record<string, unknown> {
  const handoffId = String(args["handoff_id"] ?? "");
  const record = state.handoffs.get(handoffId);

  if (!record) {
    return {
      handoff_id: handoffId,
      cloud_session_id: "",
      status: "failed" as const,
      completed_at: new Date().toISOString(),
      error: `Unknown handoff: ${handoffId}`,
    };
  }

  record.ephemeral_public_key = String(args["ephemeral_public_key"] ?? "");
  record.state = "completed";
  record.cloud_session_id = `cloud-${randomUUID().slice(0, 8)}`;

  const receipt: HandoffReceipt = {
    handoff_id: handoffId,
    cloud_session_id: record.cloud_session_id,
    status: "completed",
    completed_at: new Date().toISOString(),
    pickup_url: `https://cloud.joyus.test/sessions/${record.cloud_session_id}`,
  };

  return receipt;
}

function handleHandoffStatus(
  args: Record<string, unknown>,
  state: HarnessState,
): Record<string, unknown> {
  const handoffId = String(args["handoff_id"] ?? "");
  const record = state.handoffs.get(handoffId);

  if (!record) {
    return {
      handoff_id: handoffId,
      state: "failed" as HandoffState,
      chunks_received: 0,
      chunks_total: 0,
      artifacts_received: 0,
      artifacts_total: 0,
      error: `Unknown handoff: ${handoffId}`,
    };
  }

  return {
    handoff_id: handoffId,
    state: record.state,
    chunks_received: record.chunks_received,
    chunks_total: record.manifest.chunk_count,
    artifacts_received: record.artifacts_received,
    artifacts_total: record.manifest.artifact_count,
    ...(record.error !== undefined ? { error: record.error } : {}),
  };
}

function handleRequestWorkspace(args: Record<string, unknown>): Record<string, unknown> {
  return {
    workspace_id: `ws-${randomUUID().slice(0, 8)}`,
    tenant_id: String(args["tenant_id"] ?? "mock-tenant"),
    mode: args["mode"] ?? "managed_remote",
    created_by: "harness-user",
    label: (args["label"] as string | undefined) ?? null,
    created_at: new Date().toISOString(),
    status: "ready",
  };
}

function handleGetProvenance(args: Record<string, unknown>): Record<string, unknown> {
  return {
    artifact_id: String(args["artifact_id"] ?? "unknown"),
    origin: "test-harness",
    created_at: new Date().toISOString(),
    signatures: [],
    chain: [],
  };
}

// ---------------------------------------------------------------------------
// MCP JSON-RPC dispatcher
// ---------------------------------------------------------------------------

type ToolHandler = (
  args: Record<string, unknown>,
  state: HarnessState,
  baseUrl: string,
  defaultDecision: "allow" | "deny" | "escalate",
) => Record<string, unknown>;

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  verify_before_action: (args, state, _baseUrl, defaultDecision) =>
    handleVerifyBeforeAction(args, state, defaultDecision),
  initiate_handoff: (args, state, baseUrl) =>
    handleInitiateHandoff(args, state, baseUrl),
  complete_handoff: (args, state) =>
    handleCompleteHandoff(args, state),
  handoff_status: (args, state) =>
    handleHandoffStatus(args, state),
  request_workspace: (args) =>
    handleRequestWorkspace(args),
  get_provenance: (args) =>
    handleGetProvenance(args),
};

interface McpRequest {
  jsonrpc: string;
  id: string | number | null;
  method: string;
  params: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

function dispatchMcp(
  body: McpRequest,
  state: HarnessState,
  baseUrl: string,
  defaultDecision: "allow" | "deny" | "escalate",
): { status: number; body: Record<string, unknown> } {
  const toolName = body.params?.name;
  const args = body.params?.arguments ?? {};

  state.toolCallLog.push({ tool: toolName, args, timestamp: Date.now() });

  const handler = TOOL_HANDLERS[toolName];
  if (!handler) {
    return {
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: body.id ?? null,
        error: { code: -32601, message: `Unknown tool: ${toolName}` },
      },
    };
  }

  const result = handler(args, state, baseUrl, defaultDecision);
  return {
    status: 200,
    body: {
      jsonrpc: "2.0",
      id: body.id ?? null,
      result: {
        content: [{ type: "text", text: JSON.stringify(result) }],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// tus upload stubs (PATCH / HEAD)
// ---------------------------------------------------------------------------

function handleTusHead(
  _path: string,
  handoffId: string,
  state: HarnessState,
  res: ServerResponse,
): void {
  const record = state.handoffs.get(handoffId);
  if (!record) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  const offset = record.chunks_received * record.manifest.chunk_size_bytes;
  res.writeHead(200, {
    "upload-offset": String(offset),
    "upload-length": String(record.manifest.total_size_bytes),
    "tus-resumable": "1.0.0",
  });
  res.end();
}

function handleTusPatch(
  path: string,
  handoffId: string,
  state: HarnessState,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const record = state.handoffs.get(handoffId);
  if (!record) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    const data = Buffer.concat(chunks);
    const isArtifact = path.includes("/artifacts/");

    if (isArtifact) {
      record.artifacts_received++;
    } else {
      record.chunks_received++;
    }

    if (record.state === "initiated") {
      record.state = "transferring";
    }

    const offset = isArtifact
      ? data.length
      : record.chunks_received * record.manifest.chunk_size_bytes;

    res.writeHead(204, {
      "upload-offset": String(offset),
      "tus-resumable": "1.0.0",
    });
    res.end();
  });
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function collectBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: string) => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function createHarnessServer(
  state: HarnessState,
  baseUrlRef: { value: string },
  defaultDecision: "allow" | "deny" | "escalate",
): Server {
  return createServer((req, res) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    // Health check
    if (method === "GET" && url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", mode: "test-harness" }));
      return;
    }

    // MCP endpoint
    if (method === "POST" && url === "/mcp") {
      void collectBody(req).then((body) => {
        try {
          const parsed = JSON.parse(body) as McpRequest;
          const response = dispatchMcp(parsed, state, baseUrlRef.value, defaultDecision);
          res.writeHead(response.status, { "content-type": "application/json" });
          res.end(JSON.stringify(response.body));
        } catch {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { code: -32700, message: "Parse error" } }));
        }
      });
      return;
    }

    // tus upload endpoints: /session-handoff/{id}/upload or /session-handoff/{id}/artifacts/{aid}
    const tusMatch = url.match(/^\/session-handoff\/([^/]+)\/(upload|artifacts\/.+)$/);
    if (tusMatch) {
      const handoffId = tusMatch[1]!;

      if (method === "HEAD") {
        handleTusHead(url, handoffId, state, res);
        return;
      }

      if (method === "PATCH") {
        handleTusPatch(url, handoffId, state, req, res);
        return;
      }

      // tus OPTIONS (for protocol discovery)
      if (method === "OPTIONS") {
        res.writeHead(204, {
          "tus-resumable": "1.0.0",
          "tus-version": "1.0.0",
          "tus-extension": "creation",
        });
        res.end();
        return;
      }
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function startTestControlPlane(
  options?: HarnessOptions,
): Promise<HarnessHandle> {
  const port = options?.port ?? 0;
  const defaultDecision = options?.defaultPolicyDecision ?? "allow";

  const state: HarnessState = {
    handoffs: new Map(),
    policyDecisions: new Map(),
    toolCallLog: [],
  };

  const baseUrlRef = { value: "" };
  const server = createHarnessServer(state, baseUrlRef, defaultDecision);

  return new Promise((resolve, reject) => {
    server.on("error", reject);

    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("Unexpected address format"));
        return;
      }

      baseUrlRef.value = `http://127.0.0.1:${addr.port}`;

      resolve({
        baseUrl: baseUrlRef.value,
        close: () => new Promise<void>((res) => server.close(() => res())),
        state,
      });
    });
  });
}
