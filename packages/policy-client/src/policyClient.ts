export type RiskLevel = "low" | "medium" | "high";

export interface DecisionToken {
  jti: string;
  tenantId: string;
  workspaceId: string;
  actionHash: string;
  expEpochSeconds: number;
}

export interface DecisionContext {
  tenantId: string;
  workspaceId: string;
  actionHash: string;
}

export interface ValidationResult {
  ok: boolean;
  reason?:
    | "expired"
    | "missing_jti"
    | "tenant_mismatch"
    | "workspace_mismatch"
    | "action_mismatch";
}

export function validateDecisionToken(
  token: DecisionToken,
  context: DecisionContext,
  nowEpochSeconds: number = Math.floor(Date.now() / 1000)
): ValidationResult {
  if (!token.jti.trim()) {
    return { ok: false, reason: "missing_jti" };
  }

  if (token.expEpochSeconds <= nowEpochSeconds) {
    return { ok: false, reason: "expired" };
  }

  if (token.tenantId !== context.tenantId) {
    return { ok: false, reason: "tenant_mismatch" };
  }

  if (token.workspaceId !== context.workspaceId) {
    return { ok: false, reason: "workspace_mismatch" };
  }

  if (token.actionHash !== context.actionHash) {
    return { ok: false, reason: "action_mismatch" };
  }

  return { ok: true };
}

export function requiresHumanApproval(risk: RiskLevel, outcome: "allow" | "deny" | "escalate"): boolean {
  return outcome === "escalate" || risk === "high";
}
