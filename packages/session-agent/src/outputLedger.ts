import type { RiskLevel, TenantClass } from "./runtimeRouting";

export interface OutputEventInput {
  tenantId: string;
  workspaceId: string;
  sessionId: string;
  actionType: string;
  riskLevel: RiskLevel;
  policyResult: "allow" | "deny" | "escalate";
  runtimeTarget: "local" | "remote";
  skillIds?: string[];
  artifactIds?: string[];
  latencyMs?: number;
  policyDecisionJti?: string;
  policyDecisionToken?: string;
}

export interface OutputEvent {
  tenant_id: string;
  workspace_id: string;
  session_id: string;
  action_type: string;
  risk_level: RiskLevel;
  policy_result: "allow" | "deny" | "escalate";
  runtime_target: "local" | "remote";
  skill_ids: string[];
  artifact_ids: string[];
  latency_ms: number;
  policy_decision_jti?: string;
  policy_decision_token?: string;
}

export interface DualWritePlan {
  writeLocal: boolean;
  writeRemote: boolean;
  failClosedOnRemoteFailure: boolean;
}

export interface FetchLikeResponse {
  ok: boolean;
  status: number;
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

export function buildOutputEvent(input: OutputEventInput): OutputEvent {
  const event: OutputEvent = {
    tenant_id: input.tenantId,
    workspace_id: input.workspaceId,
    session_id: input.sessionId,
    action_type: input.actionType,
    risk_level: input.riskLevel,
    policy_result: input.policyResult,
    runtime_target: input.runtimeTarget,
    skill_ids: input.skillIds ?? [],
    artifact_ids: input.artifactIds ?? [],
    latency_ms: input.latencyMs ?? 0
  };

  if (input.policyDecisionJti !== undefined) {
    event.policy_decision_jti = input.policyDecisionJti;
  }

  if (input.policyDecisionToken !== undefined) {
    event.policy_decision_token = input.policyDecisionToken;
  }

  return event;
}

export function planDualWrite(
  tenantClass: TenantClass,
  privilegedAction: boolean,
  remoteLedgerEnabled: boolean
): DualWritePlan {
  if (privilegedAction) {
    return {
      writeLocal: true,
      writeRemote: true,
      failClosedOnRemoteFailure: tenantClass === "external"
    };
  }

  return {
    writeLocal: true,
    writeRemote: remoteLedgerEnabled,
    failClosedOnRemoteFailure: false
  };
}

export async function sendOutputEvent(
  fetchLike: FetchLike,
  input: {
    baseUrl: string;
    bearerToken: string;
    event: OutputEvent;
  }
): Promise<void> {
  const base = input.baseUrl.replace(/\/+$/, "");
  const response = await fetchLike(`${base}/mcp`, {
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
        name: "submit_output",
        arguments: input.event
      }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`MCP submit_output failed (${response.status}): ${text}`);
  }
}
