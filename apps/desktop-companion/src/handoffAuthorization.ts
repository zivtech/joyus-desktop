import type { FetchLike, PolicyDecideResponse } from "@joyus/policy-client";
import {
  HandoffError,
  buildPolicyDecideRequest,
  requestPolicyDecision,
} from "@joyus/policy-client";

export type HandoffAuthResult =
  | { decision: "allow"; policy_token: string; token_expires_at: string }
  | { decision: "deny"; reason: string }
  | { decision: "escalate"; reason: string };

export interface HandoffAuthParams {
  session_id: string;
  tenant_id: string;
  workspace_id: string;
  fetchLike: FetchLike;
  baseUrl: string;
  bearerToken: string;
}

export async function requestHandoffAuthorization(
  params: HandoffAuthParams
): Promise<HandoffAuthResult> {
  const request = buildPolicyDecideRequest({
    actionName: "session_handoff",
    riskLevel: "medium",
    tenantId: params.tenant_id,
    sessionId: params.session_id,
    workspaceId: params.workspace_id,
  });

  let response: PolicyDecideResponse;
  try {
    response = await requestPolicyDecision(params.fetchLike, {
      baseUrl: params.baseUrl,
      bearerToken: params.bearerToken,
      request,
    });
  } catch (error: unknown) {
    // Any failure to reach or parse policy service = unavailable = fail closed
    const message = error instanceof Error ? error.message : String(error);
    throw new HandoffError(
      "POLICY_UNAVAILABLE",
      `Policy service unavailable: ${message}`
    );
  }

  switch (response.decision) {
    case "allow":
      return {
        decision: "allow",
        policy_token: response.token,
        token_expires_at: response.token_expires_at,
      };
    case "deny":
      throw new HandoffError(
        "POLICY_DENIED",
        `Handoff denied: ${response.reason}`
      );
    case "escalate":
      throw new HandoffError(
        "POLICY_ESCALATED",
        `Handoff requires approval: ${response.reason}`
      );
    default: {
      // Unexpected decision value = treat as unavailable
      const _exhaustive: never = response.decision;
      throw new HandoffError(
        "POLICY_UNAVAILABLE",
        `Unexpected policy decision: ${String(_exhaustive)}`
      );
    }
  }
}
