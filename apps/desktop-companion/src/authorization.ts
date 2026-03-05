export type RiskLevel = "low" | "medium" | "high";
export type Outcome = "allow" | "deny" | "escalate";

export interface AuthorizationInput {
  riskLevel: RiskLevel;
  outcome: Outcome;
  policyAvailable: boolean;
  externalTenant: boolean;
}

export interface AuthorizationResult {
  allowed: boolean;
  needsApproval: boolean;
  reason:
    | "allowed"
    | "denied_by_policy"
    | "approval_required"
    | "degraded_low_risk"
    | "policy_unavailable_fail_closed";
}

export function authorizeAction(input: AuthorizationInput): AuthorizationResult {
  if (!input.policyAvailable) {
    if (input.externalTenant && input.riskLevel !== "low") {
      return {
        allowed: false,
        needsApproval: false,
        reason: "policy_unavailable_fail_closed"
      };
    }

    if (input.riskLevel === "high") {
      return {
        allowed: false,
        needsApproval: false,
        reason: "policy_unavailable_fail_closed"
      };
    }

    return {
      allowed: true,
      needsApproval: false,
      reason: "degraded_low_risk"
    };
  }

  if (input.outcome === "deny") {
    return {
      allowed: false,
      needsApproval: false,
      reason: "denied_by_policy"
    };
  }

  if (input.outcome === "escalate") {
    return {
      allowed: false,
      needsApproval: true,
      reason: "approval_required"
    };
  }

  return {
    allowed: true,
    needsApproval: false,
    reason: "allowed"
  };
}
