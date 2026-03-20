export type RiskLevel = "low" | "medium" | "high" | "critical";

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

export interface DecisionTokenClaimMap {
  jti: string;
  exp: string;
  tenantId: string;
  workspaceId: string;
  actionHash: string;
}

export const defaultDecisionTokenClaimMap: DecisionTokenClaimMap = {
  jti: "jti",
  exp: "exp",
  tenantId: "tenant_id",
  workspaceId: "workspace_id",
  actionHash: "action_hash"
};

export type DecisionTokenDecodeFailureReason = "malformed_token" | "missing_claims" | "invalid_signature";

export type DecisionTokenDecodeResult =
  | {
      ok: true;
      token: DecisionToken;
    }
  | {
      ok: false;
      reason: DecisionTokenDecodeFailureReason;
    };

export interface DecisionTokenVerifier {
  verifyAndDecode(
    token: string,
    claimMap: DecisionTokenClaimMap
  ): DecisionTokenDecodeResult | Promise<DecisionTokenDecodeResult>;
}

export interface ValidationResult {
  ok: boolean;
  reason?:
    | "expired"
    | "missing_jti"
    | "malformed_token"
    | "tenant_mismatch"
    | "workspace_mismatch"
    | "action_mismatch";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return atob(padded);
}

function parseJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const payloadPart = parts[1];
  if (!payloadPart) {
    return null;
  }

  try {
    const parsed = JSON.parse(decodeBase64Url(payloadPart));
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readEpochSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

export function decodeDecisionToken(
  encodedToken: string,
  claimMap: DecisionTokenClaimMap = defaultDecisionTokenClaimMap
): DecisionTokenDecodeResult {
  if (!isNonEmptyString(encodedToken)) {
    return { ok: false, reason: "malformed_token" };
  }

  const payload = parseJwtPayload(encodedToken);
  if (!payload) {
    return { ok: false, reason: "malformed_token" };
  }

  const jti = payload[claimMap.jti];
  const tenantId = payload[claimMap.tenantId];
  const workspaceId = payload[claimMap.workspaceId];
  const actionHash = payload[claimMap.actionHash];
  const expEpochSeconds = readEpochSeconds(payload[claimMap.exp]);

  if (!isNonEmptyString(jti) || !isNonEmptyString(tenantId) || !isNonEmptyString(workspaceId) || !isNonEmptyString(actionHash)) {
    return { ok: false, reason: "missing_claims" };
  }

  if (expEpochSeconds === null) {
    return { ok: false, reason: "missing_claims" };
  }

  return {
    ok: true,
    token: {
      jti,
      tenantId,
      workspaceId,
      actionHash,
      expEpochSeconds
    }
  };
}

export function createDecisionTokenVerifier(input: {
  validateSignature: (encodedToken: string) => boolean | Promise<boolean>;
}): DecisionTokenVerifier {
  return {
    async verifyAndDecode(
      encodedToken: string,
      claimMap: DecisionTokenClaimMap
    ): Promise<DecisionTokenDecodeResult> {
      const decoded = decodeDecisionToken(encodedToken, claimMap);
      if (!decoded.ok) {
        return decoded;
      }

      const signatureValid = await input.validateSignature(encodedToken);
      if (!signatureValid) {
        return { ok: false, reason: "invalid_signature" };
      }

      return decoded;
    }
  };
}

export function validateDecisionToken(
  token: DecisionToken,
  context: DecisionContext,
  nowEpochSeconds: number = Math.floor(Date.now() / 1000)
): ValidationResult {
  if (!isNonEmptyString(token.jti)) {
    return { ok: false, reason: "missing_jti" };
  }

  if (typeof token.expEpochSeconds !== "number" || !Number.isFinite(token.expEpochSeconds)) {
    return { ok: false, reason: "malformed_token" };
  }

  if (!isNonEmptyString(token.tenantId) || !isNonEmptyString(token.workspaceId) || !isNonEmptyString(token.actionHash)) {
    return { ok: false, reason: "malformed_token" };
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
  return outcome === "escalate" || risk === "high" || risk === "critical";
}
