import type { RiskLevel } from "./policyClient";

export type PolicyOutcome = "allow" | "deny" | "escalate";

export interface PolicyDecideRequest {
  action: {
    name: string;
    risk_level: RiskLevel;
    target?: string;
    details?: Record<string, unknown>;
  };
  session: {
    session_id: string;
    tenant_id: string;
    workspace_id?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface PolicyDecideResponse {
  decision: PolicyOutcome;
  reason: string;
  token: string;
  token_expires_at: string;
  jti: string;
  risk_level: RiskLevel;
}

export interface WorkspaceRecord {
  workspace_id: string;
  tenant_id: string;
  mode: "managed_remote" | "local";
  created_by: string;
  label: string | null;
  created_at: string;
  status: "ready";
}

export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  }
) => Promise<FetchLikeResponse>;

interface McpToolContent {
  type: string;
  text: string;
}

interface McpToolCallResponse {
  result?: {
    content?: McpToolContent[];
  };
  error?: {
    code?: number;
    message?: string;
  };
}

export function buildControlPlaneUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

export function buildPolicyDecideRequest(input: {
  actionName: string;
  riskLevel: RiskLevel;
  tenantId: string;
  sessionId: string;
  workspaceId?: string;
  target?: string;
  details?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): PolicyDecideRequest {
  const action: PolicyDecideRequest["action"] = {
    name: input.actionName,
    risk_level: input.riskLevel
  };

  if (input.target !== undefined) {
    action.target = input.target;
  }

  if (input.details !== undefined) {
    action.details = input.details;
  }

  const session: PolicyDecideRequest["session"] = {
    session_id: input.sessionId,
    tenant_id: input.tenantId
  };

  if (input.workspaceId !== undefined) {
    session.workspace_id = input.workspaceId;
  }

  const request: PolicyDecideRequest = {
    action,
    session
  };

  if (input.metadata !== undefined) {
    request.metadata = input.metadata;
  }

  return request;
}

function isRiskLevel(value: unknown): value is RiskLevel {
  return value === "low" || value === "medium" || value === "high" || value === "critical";
}

function isPolicyOutcome(value: unknown): value is PolicyOutcome {
  return value === "allow" || value === "deny" || value === "escalate";
}

export function parsePolicyDecideResponse(raw: unknown): PolicyDecideResponse {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid policy decision response: expected object");
  }

  const value = raw as Record<string, unknown>;

  if (!isPolicyOutcome(value.decision)) {
    throw new Error("Invalid policy decision response: decision");
  }

  if (typeof value.reason !== "string" || !value.reason.trim()) {
    throw new Error("Invalid policy decision response: reason");
  }

  if (typeof value.token !== "string" || !value.token.includes(".")) {
    throw new Error("Invalid policy decision response: token");
  }

  if (typeof value.token_expires_at !== "string" || !value.token_expires_at.trim()) {
    throw new Error("Invalid policy decision response: token_expires_at");
  }

  if (typeof value.jti !== "string" || !value.jti.trim()) {
    throw new Error("Invalid policy decision response: jti");
  }

  if (!isRiskLevel(value.risk_level)) {
    throw new Error("Invalid policy decision response: risk_level");
  }

  return {
    decision: value.decision,
    reason: value.reason,
    token: value.token,
    token_expires_at: value.token_expires_at,
    jti: value.jti,
    risk_level: value.risk_level
  };
}

function parseMcpToolText(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid MCP response: expected object");
  }

  const response = raw as McpToolCallResponse;
  if (response.error) {
    throw new Error(
      `MCP tool call failed (${response.error.code ?? "unknown"}): ${response.error.message ?? "Unknown error"}`
    );
  }

  const content = response.result?.content;
  if (!Array.isArray(content) || content.length === 0) {
    throw new Error("Invalid MCP response: missing content");
  }

  const first = content[0];
  if (!first || first.type !== "text" || typeof first.text !== "string" || !first.text.trim()) {
    throw new Error("Invalid MCP response: missing text content");
  }

  try {
    return JSON.parse(first.text);
  } catch {
    throw new Error("Invalid MCP response: content is not valid JSON");
  }
}

export async function callMcpTool(
  fetchLike: FetchLike,
  input: {
    baseUrl: string;
    bearerToken: string;
    toolName: string;
    arguments: Record<string, unknown>;
  }
): Promise<unknown> {
  const response = await fetchLike(buildControlPlaneUrl(input.baseUrl, "/mcp"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.bearerToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "cp-tool-1",
      method: "tools/call",
      params: {
        name: input.toolName,
        arguments: input.arguments
      }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`MCP request failed (${response.status}): ${text}`);
  }

  return parseMcpToolText(await response.json());
}

export async function requestPolicyDecision(
  fetchLike: FetchLike,
  input: {
    baseUrl: string;
    bearerToken: string;
    request: PolicyDecideRequest;
  }
): Promise<PolicyDecideResponse> {
  const raw = await callMcpTool(fetchLike, {
    baseUrl: input.baseUrl,
    bearerToken: input.bearerToken,
    toolName: "verify_before_action",
    arguments: {
      tenant_id: input.request.session.tenant_id,
      workspace_id: input.request.session.workspace_id,
      session_id: input.request.session.session_id,
      action_name: input.request.action.name,
      risk_level: input.request.action.risk_level,
      target: input.request.action.target,
      details: input.request.action.details,
      metadata: input.request.metadata
    }
  });

  return parsePolicyDecideResponse(raw);
}

function parseWorkspaceRecord(raw: unknown): WorkspaceRecord {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid workspace response: expected object");
  }

  const value = raw as Record<string, unknown>;

  if (typeof value.workspace_id !== "string" || !value.workspace_id.trim()) {
    throw new Error("Invalid workspace response: workspace_id");
  }
  if (typeof value.tenant_id !== "string" || !value.tenant_id.trim()) {
    throw new Error("Invalid workspace response: tenant_id");
  }
  if (value.mode !== "managed_remote" && value.mode !== "local") {
    throw new Error("Invalid workspace response: mode");
  }
  if (typeof value.created_by !== "string") {
    throw new Error("Invalid workspace response: created_by");
  }
  if (value.label !== null && typeof value.label !== "string") {
    throw new Error("Invalid workspace response: label");
  }
  if (typeof value.created_at !== "string" || !value.created_at.trim()) {
    throw new Error("Invalid workspace response: created_at");
  }
  if (value.status !== "ready") {
    throw new Error("Invalid workspace response: status");
  }

  return {
    workspace_id: value.workspace_id,
    tenant_id: value.tenant_id,
    mode: value.mode,
    created_by: value.created_by,
    label: value.label as string | null,
    created_at: value.created_at,
    status: value.status,
  };
}

export async function requestWorkspace(
  fetchLike: FetchLike,
  input: {
    baseUrl: string;
    bearerToken: string;
    tenantId: string;
    mode?: "managed_remote" | "local";
    label?: string;
  }
): Promise<WorkspaceRecord> {
  const raw = await callMcpTool(fetchLike, {
    baseUrl: input.baseUrl,
    bearerToken: input.bearerToken,
    toolName: "request_workspace",
    arguments: {
      tenant_id: input.tenantId,
      mode: input.mode ?? "managed_remote",
      label: input.label
    }
  });

  return parseWorkspaceRecord(raw);
}

export async function getArtifactProvenance(
  fetchLike: FetchLike,
  input: {
    baseUrl: string;
    bearerToken: string;
    artifactId: string;
  }
): Promise<Record<string, unknown>> {
  const raw = await callMcpTool(fetchLike, {
    baseUrl: input.baseUrl,
    bearerToken: input.bearerToken,
    toolName: "get_provenance",
    arguments: {
      artifact_id: input.artifactId
    }
  });

  return raw as Record<string, unknown>;
}
