import {
  buildPolicyDecideRequest,
  defaultDecisionTokenClaimMap,
  getArtifactProvenance,
  requestPolicyDecision
} from "@joyus/policy-client";
import type {
  DecisionTokenClaimMap,
  DecisionTokenVerifier,
  FetchLike as ControlPlaneFetchLike
} from "@joyus/policy-client";
import { sendOutputEvent } from "@joyus/session-agent";
import type { OutputEvent, RuntimeTarget } from "@joyus/session-agent";

import { planRuntimeExecution } from "./runtimeOrchestrator";
import type {
  DecisionJtiRegistry,
  RuntimeOrchestratorInput,
  RuntimeOrchestratorResult,
  RuntimeReasonCode
} from "./runtimeOrchestrator";
import type { RiskLevel } from "./authorization";

export interface ActionExecutionResult {
  skillIds?: string[];
  artifactIds?: string[];
  latencyMs?: number;
}

export interface RuntimeExecutionInput {
  controlPlane: {
    baseUrl: string;
    bearerToken: string;
    fetchLike: ControlPlaneFetchLike;
  };
  tenantClass: RuntimeOrchestratorInput["tenantClass"];
  localAllowedForTenant: boolean;
  remoteLedgerEnabled: boolean;
  tenantId: string;
  workspaceId: string;
  sessionId: string;
  action: {
    name: string;
    type: string;
    hash: string;
    riskLevel: RiskLevel;
    isPrivileged: boolean;
    target?: string;
    details?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
  jtiRegistry: DecisionJtiRegistry;
  tokenVerifier: DecisionTokenVerifier;
  tokenClaimMap?: DecisionTokenClaimMap;
  nowEpochSeconds?: number;
  executeAction?: (runtimeTarget: RuntimeTarget) => Promise<ActionExecutionResult | void>;
  telemetrySink?: RuntimeTelemetrySink;
  provenance?: RuntimeProvenanceSettings;
}

export type RuntimeExecutionReasonCode =
  | RuntimeReasonCode
  | "action_execution_failed"
  | "output_submit_failed_fail_closed"
  | "provenance_lookup_failed"
  | "provenance_verification_failed";

export type RuntimeTelemetryEventName =
  | "policy_request_started"
  | "policy_request_completed"
  | "policy_request_failed"
  | "token_verified"
  | "decision_planned"
  | "action_execution_started"
  | "action_execution_completed"
  | "action_execution_failed"
  | "provenance_check_started"
  | "provenance_check_completed"
  | "output_submit_started"
  | "output_submit_completed"
  | "output_submit_failed";

export interface RuntimeTelemetryEvent {
  name: RuntimeTelemetryEventName;
  timestampIso: string;
  tenantId: string;
  workspaceId: string;
  sessionId: string;
  actionName: string;
  riskLevel: RiskLevel;
  isPrivileged: boolean;
  status?: RuntimeOrchestratorResult["status"];
  reasonCode?: RuntimeExecutionReasonCode;
  runtimeTarget?: RuntimeTarget;
  failClosed?: boolean;
  metadata?: Record<string, unknown>;
}

export interface RuntimeTelemetrySink {
  record(event: RuntimeTelemetryEvent): void | Promise<void>;
}

export type ProvenanceMode = "audit" | "enforce" | "off";

export interface RuntimeProvenanceSettings {
  mode?: ProvenanceMode;
  artifactIdSelector?: (result: ActionExecutionResult) => string[];
}

export interface ProvenanceReport {
  mode: ProvenanceMode;
  checkedArtifactIds: string[];
  failedArtifactIds: string[];
}

export interface RuntimeExecutionResult {
  status: RuntimeOrchestratorResult["status"];
  reasonCode: RuntimeExecutionReasonCode;
  plan: RuntimeOrchestratorResult;
  actionExecuted: boolean;
  actionResult?: ActionExecutionResult;
  actionError?: string;
  provenanceReport?: ProvenanceReport;
  outputSubmitted: boolean;
  outputSubmissionError?: string;
}

export async function executeRuntimeAction(input: RuntimeExecutionInput): Promise<RuntimeExecutionResult> {
  const emit = (event: Omit<RuntimeTelemetryEvent, "timestampIso">) =>
    emitTelemetry(input.telemetrySink, {
      ...event,
      timestampIso: new Date().toISOString()
    });

  const tokenClaimMap = input.tokenClaimMap ?? defaultDecisionTokenClaimMap;
  const policy = await resolvePolicyState(input, tokenClaimMap, emit);

  const planInput: RuntimeOrchestratorInput = {
    tenantClass: input.tenantClass,
    localAllowedForTenant: input.localAllowedForTenant,
    remoteLedgerEnabled: input.remoteLedgerEnabled,
    action: {
      actionType: input.action.type,
      actionHash: input.action.hash,
      riskLevel: input.action.riskLevel,
      isPrivileged: input.action.isPrivileged
    },
    context: {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId
    },
    policy,
    jtiRegistry: input.jtiRegistry,
    ...(input.nowEpochSeconds !== undefined ? { nowEpochSeconds: input.nowEpochSeconds } : {})
  };

  const plan = planRuntimeExecution(planInput);

  await emit({
    name: "decision_planned",
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    actionName: input.action.name,
    riskLevel: input.action.riskLevel,
    isPrivileged: input.action.isPrivileged,
    status: plan.status,
    reasonCode: plan.reasonCode,
    runtimeTarget: plan.runtimeTarget,
    failClosed: plan.dualWritePlan.failClosedOnRemoteFailure
  });

  let actionExecuted = false;
  let actionResult: ActionExecutionResult | undefined;
  let actionError: string | undefined;
  let provenanceReport: ProvenanceReport | undefined;
  let status: RuntimeOrchestratorResult["status"] = plan.status;
  let reasonCode: RuntimeExecutionReasonCode = plan.reasonCode;

  if (plan.status === "allowed" && input.executeAction) {
    await emit({
      name: "action_execution_started",
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      actionName: input.action.name,
      riskLevel: input.action.riskLevel,
      isPrivileged: input.action.isPrivileged,
      runtimeTarget: plan.runtimeTarget
    });

    try {
      const result = await input.executeAction(plan.runtimeTarget);
      actionExecuted = true;
      if (result !== undefined) {
        actionResult = result;
      }

      await emit({
        name: "action_execution_completed",
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        actionName: input.action.name,
        riskLevel: input.action.riskLevel,
        isPrivileged: input.action.isPrivileged,
        status,
        reasonCode,
        runtimeTarget: plan.runtimeTarget
      });
    } catch (error) {
      status = "error";
      reasonCode = "action_execution_failed";
      actionError = error instanceof Error ? error.message : String(error);

      await emit({
        name: "action_execution_failed",
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        actionName: input.action.name,
        riskLevel: input.action.riskLevel,
        isPrivileged: input.action.isPrivileged,
        status,
        reasonCode,
        runtimeTarget: plan.runtimeTarget,
        metadata: {
          actionError
        }
      });
    }
  }

  const provenanceMode = input.provenance?.mode ?? "audit";
  if (actionResult && provenanceMode !== "off") {
    const artifactIds = input.provenance?.artifactIdSelector
      ? input.provenance.artifactIdSelector(actionResult)
      : actionResult.artifactIds ?? [];

    await emit({
      name: "provenance_check_started",
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      actionName: input.action.name,
      riskLevel: input.action.riskLevel,
      isPrivileged: input.action.isPrivileged,
      runtimeTarget: plan.runtimeTarget,
      metadata: {
        mode: provenanceMode,
        artifactCount: artifactIds.length
      }
    });

    const failures = await verifyProvenance(input, artifactIds);
    provenanceReport = {
      mode: provenanceMode,
      checkedArtifactIds: artifactIds,
      failedArtifactIds: failures.map((entry) => entry.artifactId)
    };

    if (failures.length > 0 && provenanceMode === "enforce") {
      status = "error";
      reasonCode = failures.some((entry) => entry.kind === "lookup")
        ? "provenance_lookup_failed"
        : "provenance_verification_failed";
    }

    await emit({
      name: "provenance_check_completed",
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      actionName: input.action.name,
      riskLevel: input.action.riskLevel,
      isPrivileged: input.action.isPrivileged,
      status,
      reasonCode,
      runtimeTarget: plan.runtimeTarget,
      metadata: {
        mode: provenanceMode,
        checkedArtifactIds: artifactIds,
        failedArtifactIds: provenanceReport.failedArtifactIds
      }
    });
  }

  const event = mergeOutputEvent(plan.outputEvent, actionResult);

  await emit({
    name: "output_submit_started",
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    actionName: input.action.name,
    riskLevel: input.action.riskLevel,
    isPrivileged: input.action.isPrivileged,
    status,
    reasonCode,
    runtimeTarget: plan.runtimeTarget,
    failClosed: plan.dualWritePlan.failClosedOnRemoteFailure
  });

  try {
    await sendOutputEvent(input.controlPlane.fetchLike, {
      baseUrl: input.controlPlane.baseUrl,
      bearerToken: input.controlPlane.bearerToken,
      event
    });

    await emit({
      name: "output_submit_completed",
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      actionName: input.action.name,
      riskLevel: input.action.riskLevel,
      isPrivileged: input.action.isPrivileged,
      status,
      reasonCode,
      runtimeTarget: plan.runtimeTarget
    });

    return {
      status,
      reasonCode,
      plan,
      actionExecuted,
      ...(actionResult !== undefined ? { actionResult } : {}),
      ...(actionError !== undefined ? { actionError } : {}),
      ...(provenanceReport !== undefined ? { provenanceReport } : {}),
      outputSubmitted: true
    };
  } catch (error) {
    const outputSubmissionError = error instanceof Error ? error.message : String(error);

    await emit({
      name: "output_submit_failed",
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      actionName: input.action.name,
      riskLevel: input.action.riskLevel,
      isPrivileged: input.action.isPrivileged,
      status,
      reasonCode,
      runtimeTarget: plan.runtimeTarget,
      failClosed: plan.dualWritePlan.failClosedOnRemoteFailure,
      metadata: {
        outputSubmissionError
      }
    });

    if (plan.dualWritePlan.failClosedOnRemoteFailure) {
      return {
        status: "error",
        reasonCode: "output_submit_failed_fail_closed",
        plan,
        actionExecuted,
        ...(actionResult !== undefined ? { actionResult } : {}),
        ...(actionError !== undefined ? { actionError } : {}),
        ...(provenanceReport !== undefined ? { provenanceReport } : {}),
        outputSubmitted: false,
        outputSubmissionError
      };
    }

    return {
      status,
      reasonCode,
      plan,
      actionExecuted,
      ...(actionResult !== undefined ? { actionResult } : {}),
      ...(actionError !== undefined ? { actionError } : {}),
      ...(provenanceReport !== undefined ? { provenanceReport } : {}),
      outputSubmitted: false,
      outputSubmissionError
    };
  }
}

async function resolvePolicyState(
  input: RuntimeExecutionInput,
  tokenClaimMap: DecisionTokenClaimMap,
  emit: (event: Omit<RuntimeTelemetryEvent, "timestampIso">) => Promise<void>
): Promise<RuntimeOrchestratorInput["policy"]> {
  if (!input.action.isPrivileged) {
    return { policyAvailable: false };
  }

  await emit({
    name: "policy_request_started",
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    actionName: input.action.name,
    riskLevel: input.action.riskLevel,
    isPrivileged: input.action.isPrivileged
  });

  try {
    const policyDecision = await requestPolicyDecision(input.controlPlane.fetchLike, {
      baseUrl: input.controlPlane.baseUrl,
      bearerToken: input.controlPlane.bearerToken,
      request: buildPolicyDecideRequest({
        actionName: input.action.name,
        riskLevel: input.action.riskLevel,
        tenantId: input.tenantId,
        sessionId: input.sessionId,
        workspaceId: input.workspaceId,
        ...(input.action.target !== undefined ? { target: input.action.target } : {}),
        ...(input.action.details !== undefined ? { details: input.action.details } : {}),
        ...(input.action.metadata !== undefined ? { metadata: input.action.metadata } : {})
      })
    });

    const tokenVerification = await input.tokenVerifier.verifyAndDecode(policyDecision.token, tokenClaimMap);

    await emit({
      name: "token_verified",
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      actionName: input.action.name,
      riskLevel: input.action.riskLevel,
      isPrivileged: input.action.isPrivileged,
      metadata: {
        ok: tokenVerification.ok,
        ...(tokenVerification.ok ? {} : { reason: tokenVerification.reason })
      }
    });

    await emit({
      name: "policy_request_completed",
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      actionName: input.action.name,
      riskLevel: input.action.riskLevel,
      isPrivileged: input.action.isPrivileged
    });

    return {
      policyAvailable: true,
      outcome: policyDecision.decision,
      responseRiskLevel: policyDecision.risk_level,
      tokenVerification: tokenVerification.ok
        ? { ok: true, decisionToken: tokenVerification.token }
        : { ok: false, reason: tokenVerification.reason },
      policyDecisionToken: policyDecision.token,
      policyDecisionJti: policyDecision.jti
    };
  } catch (error) {
    await emit({
      name: "policy_request_failed",
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      actionName: input.action.name,
      riskLevel: input.action.riskLevel,
      isPrivileged: input.action.isPrivileged,
      metadata: {
        // Raw error message intentionally excluded to prevent bearer token leakage
        errorType: error instanceof Error ? error.name : "unknown"
      }
    });

    return { policyAvailable: false };
  }
}

async function verifyProvenance(
  input: RuntimeExecutionInput,
  artifactIds: string[]
): Promise<Array<{ artifactId: string; kind: "lookup" | "mismatch" }>> {
  const failures: Array<{ artifactId: string; kind: "lookup" | "mismatch" }> = [];

  for (const artifactId of artifactIds) {
    try {
      const record = await getArtifactProvenance(input.controlPlane.fetchLike, {
        baseUrl: input.controlPlane.baseUrl,
        bearerToken: input.controlPlane.bearerToken,
        artifactId
      });

      if (!isProvenanceValid(record, {
        artifactId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        sessionId: input.sessionId
      })) {
        failures.push({ artifactId, kind: "mismatch" });
      }
    } catch {
      failures.push({ artifactId, kind: "lookup" });
    }
  }

  return failures;
}

function isProvenanceValid(
  input: Record<string, unknown>,
  expected: {
    artifactId: string;
    tenantId: string;
    workspaceId: string;
    sessionId: string;
  }
): boolean {
  const artifact = isRecord(input.artifact) ? input.artifact : null;
  if (!artifact) {
    return false;
  }

  const artifactId = readString(artifact.artifact_id);
  if (artifactId === null || artifactId !== expected.artifactId) {
    return false;
  }

  const tenantId = readString(artifact.tenant_id);
  if (tenantId === null || tenantId !== expected.tenantId) {
    return false;
  }

  const workspaceId = readString(artifact.workspace_id);
  if (workspaceId === null || workspaceId !== expected.workspaceId) {
    return false;
  }

  const sessionId = readString(artifact.session_id);
  if (sessionId === null || sessionId !== expected.sessionId) {
    return false;
  }

  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function readString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  return null;
}

function mergeOutputEvent(base: OutputEvent, actionResult: ActionExecutionResult | undefined): OutputEvent {
  if (!actionResult) {
    return base;
  }

  return {
    ...base,
    ...(actionResult.skillIds !== undefined ? { skill_ids: actionResult.skillIds } : {}),
    ...(actionResult.artifactIds !== undefined ? { artifact_ids: actionResult.artifactIds } : {}),
    ...(actionResult.latencyMs !== undefined ? { latency_ms: actionResult.latencyMs } : {})
  };
}

async function emitTelemetry(
  sink: RuntimeTelemetrySink | undefined,
  event: RuntimeTelemetryEvent
): Promise<void> {
  if (!sink) {
    return;
  }

  try {
    await sink.record(event);
  } catch {
    // Telemetry failures are intentionally non-blocking.
  }
}
