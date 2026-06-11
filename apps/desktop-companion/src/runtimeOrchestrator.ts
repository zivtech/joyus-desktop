import type { DecisionToken, DecisionTokenDecodeFailureReason, ValidationResult } from "@joyus/policy-client";
import { validateDecisionToken } from "@joyus/policy-client";
import { buildOutputEvent, planDualWrite, selectRuntimeTarget } from "@joyus/session-agent";
import type { DualWritePlan, OutputEvent, RuntimeTarget, TenantClass } from "@joyus/session-agent";

import { authorizeAction } from "./authorization";
import type { AuthorizationResult, RiskLevel } from "./authorization";

type PolicyOutcome = "allow" | "deny" | "escalate";
type ValidationFailureReason = Exclude<ValidationResult["reason"], undefined>;

export type RuntimeReasonCode =
  | "non_privileged_bypass"
  | "risk_level_mismatch"
  | "decision_token_replay"
  | "jti_registry_unavailable"
  | `decision_token_verification_failed:${DecisionTokenDecodeFailureReason}`
  | AuthorizationResult["reason"]
  | `invalid_decision_token:${ValidationFailureReason}`;

export interface DecisionJtiRegistry {
  reserveIfUnused(jti: string, expEpochSeconds: number): "reserved" | "replayed" | "unavailable";
}

export interface RuntimeOrchestratorInput {
  tenantClass: TenantClass;
  localAllowedForTenant: boolean;
  remoteLedgerEnabled: boolean;
  action: {
    actionType: string;
    actionHash: string;
    riskLevel: RiskLevel;
    isPrivileged: boolean;
  };
  context: {
    tenantId: string;
    workspaceId: string;
    sessionId: string;
    skillIds?: string[];
    artifactIds?: string[];
    latencyMs?: number;
  };
  policy:
    | {
        policyAvailable: false;
      }
    | {
        policyAvailable: true;
        outcome: PolicyOutcome;
        responseRiskLevel: RiskLevel;
        tokenVerification:
          | {
              ok: true;
              decisionToken: DecisionToken;
            }
          | {
              ok: false;
              reason: DecisionTokenDecodeFailureReason;
            };
        policyDecisionToken: string;
        policyDecisionJti: string;
      };
  jtiRegistry: DecisionJtiRegistry;
  nowEpochSeconds?: number;
}

interface RuntimeResultBase {
  runtimeTarget: RuntimeTarget;
  dualWritePlan: DualWritePlan;
  outputEvent: OutputEvent;
  reasonCode: RuntimeReasonCode;
  authorizationReason?: AuthorizationResult["reason"];
}

export type RuntimeOrchestratorResult =
  | (RuntimeResultBase & { status: "allowed" })
  | (RuntimeResultBase & { status: "blocked" })
  | (RuntimeResultBase & { status: "approval_required" })
  | (RuntimeResultBase & { status: "error" });

export function planRuntimeExecution(input: RuntimeOrchestratorInput): RuntimeOrchestratorResult {
  const runtimeTarget = selectRuntimeTarget(input.tenantClass, input.localAllowedForTenant);
  const dualWritePlan = planDualWrite(input.tenantClass, input.action.isPrivileged, input.remoteLedgerEnabled);

  if (!input.action.isPrivileged) {
    return buildResult({
      status: "allowed",
      reasonCode: "non_privileged_bypass",
      policyResult: "allow",
      runtimeTarget,
      dualWritePlan,
      input
    });
  }

  if (!input.policy.policyAvailable) {
    const authorization = authorizeAction({
      riskLevel: input.action.riskLevel,
      outcome: "allow",
      policyAvailable: false,
      externalTenant: input.tenantClass === "external"
    });

    return buildAuthorizationResult(input, authorization, runtimeTarget, dualWritePlan);
  }

  if (input.policy.responseRiskLevel !== input.action.riskLevel) {
    return buildResult({
      status: "blocked",
      reasonCode: "risk_level_mismatch",
      policyResult: "deny",
      runtimeTarget,
      dualWritePlan,
      input,
      policyDecisionJti: input.policy.policyDecisionJti,
      policyDecisionToken: input.policy.policyDecisionToken
    });
  }

  if (!input.policy.tokenVerification.ok) {
    return buildResult({
      status: "blocked",
      reasonCode: `decision_token_verification_failed:${input.policy.tokenVerification.reason}`,
      policyResult: "deny",
      runtimeTarget,
      dualWritePlan,
      input,
      policyDecisionJti: input.policy.policyDecisionJti,
      policyDecisionToken: input.policy.policyDecisionToken
    });
  }

  const validation = validateDecisionToken(
    input.policy.tokenVerification.decisionToken,
    {
      tenantId: input.context.tenantId,
      workspaceId: input.context.workspaceId,
      actionHash: input.action.actionHash
    },
    input.nowEpochSeconds
  );

  if (!validation.ok) {
    const validationReason = validation.reason as ValidationFailureReason;

    return buildResult({
      status: "blocked",
      reasonCode: `invalid_decision_token:${validationReason}`,
      policyResult: "deny",
      runtimeTarget,
      dualWritePlan,
      input,
      policyDecisionJti: input.policy.policyDecisionJti,
      policyDecisionToken: input.policy.policyDecisionToken
    });
  }

  const jtiReservation = input.jtiRegistry.reserveIfUnused(
    input.policy.policyDecisionJti,
    input.policy.tokenVerification.decisionToken.expEpochSeconds
  );

  if (jtiReservation === "replayed") {
    return buildResult({
      status: "blocked",
      reasonCode: "decision_token_replay",
      policyResult: "deny",
      runtimeTarget,
      dualWritePlan,
      input,
      policyDecisionJti: input.policy.policyDecisionJti,
      policyDecisionToken: input.policy.policyDecisionToken
    });
  }

  if (jtiReservation === "unavailable") {
    return buildResult({
      status: "error",
      reasonCode: "jti_registry_unavailable",
      policyResult: "deny",
      runtimeTarget,
      dualWritePlan,
      input,
      policyDecisionJti: input.policy.policyDecisionJti,
      policyDecisionToken: input.policy.policyDecisionToken
    });
  }

  const authorization = authorizeAction({
    riskLevel: input.action.riskLevel,
    outcome: input.policy.outcome,
    policyAvailable: true,
    externalTenant: input.tenantClass === "external"
  });

  return buildAuthorizationResult(
    input,
    authorization,
    runtimeTarget,
    dualWritePlan,
    input.policy.policyDecisionJti,
    input.policy.policyDecisionToken
  );
}

function buildAuthorizationResult(
  input: RuntimeOrchestratorInput,
  authorization: AuthorizationResult,
  runtimeTarget: RuntimeTarget,
  dualWritePlan: DualWritePlan,
  policyDecisionJti?: string,
  policyDecisionToken?: string
): RuntimeOrchestratorResult {
  const policyArgs =
    policyDecisionJti !== undefined && policyDecisionToken !== undefined
      ? { policyDecisionJti, policyDecisionToken }
      : {};

  if (authorization.needsApproval) {
    return buildResult({
      status: "approval_required",
      reasonCode: authorization.reason,
      authorizationReason: authorization.reason,
      policyResult: "escalate",
      runtimeTarget,
      dualWritePlan,
      input,
      ...policyArgs
    });
  }

  if (authorization.allowed) {
    return buildResult({
      status: "allowed",
      reasonCode: authorization.reason,
      authorizationReason: authorization.reason,
      policyResult: "allow",
      runtimeTarget,
      dualWritePlan,
      input,
      ...policyArgs
    });
  }

  return buildResult({
    status: "blocked",
    reasonCode: authorization.reason,
    authorizationReason: authorization.reason,
    policyResult: "deny",
    runtimeTarget,
    dualWritePlan,
    input,
    ...policyArgs
  });
}

function buildResult(input: {
  status: RuntimeOrchestratorResult["status"];
  reasonCode: RuntimeReasonCode;
  authorizationReason?: AuthorizationResult["reason"];
  policyResult: PolicyOutcome;
  runtimeTarget: RuntimeTarget;
  dualWritePlan: DualWritePlan;
  policyDecisionJti?: string;
  policyDecisionToken?: string;
  input: RuntimeOrchestratorInput;
}): RuntimeOrchestratorResult {
  const event = buildOutputEvent({
    tenantId: input.input.context.tenantId,
    workspaceId: input.input.context.workspaceId,
    sessionId: input.input.context.sessionId,
    actionType: input.input.action.actionType,
    riskLevel: input.input.action.riskLevel,
    policyResult: input.policyResult,
    runtimeTarget: input.runtimeTarget,
    ...(input.input.context.skillIds !== undefined ? { skillIds: input.input.context.skillIds } : {}),
    ...(input.input.context.artifactIds !== undefined ? { artifactIds: input.input.context.artifactIds } : {}),
    ...(input.input.context.latencyMs !== undefined ? { latencyMs: input.input.context.latencyMs } : {}),
    ...(input.policyDecisionJti !== undefined ? { policyDecisionJti: input.policyDecisionJti } : {}),
    ...(input.policyDecisionToken !== undefined ? { policyDecisionToken: input.policyDecisionToken } : {})
  });

  return {
    status: input.status,
    reasonCode: input.reasonCode,
    ...(input.authorizationReason !== undefined ? { authorizationReason: input.authorizationReason } : {}),
    runtimeTarget: input.runtimeTarget,
    dualWritePlan: input.dualWritePlan,
    outputEvent: event
  };
}
