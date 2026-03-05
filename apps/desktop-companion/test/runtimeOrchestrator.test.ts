import { describe, expect, it, vi } from "vitest";

import { planRuntimeExecution } from "../src/runtimeOrchestrator";
import type { RuntimeOrchestratorInput } from "../src/runtimeOrchestrator";

type RuntimeInputOverrides = Omit<Partial<RuntimeOrchestratorInput>, "action" | "context" | "policy"> & {
  action?: Partial<RuntimeOrchestratorInput["action"]>;
  context?: Partial<RuntimeOrchestratorInput["context"]>;
  policy?: RuntimeOrchestratorInput["policy"];
};

function buildInput(
  overrides: RuntimeInputOverrides = {}
): RuntimeOrchestratorInput {
  const { action, context, policy, ...topLevel } = overrides;

  return {
    tenantClass: "external",
    localAllowedForTenant: false,
    remoteLedgerEnabled: true,
    action: {
      actionType: "tool_call",
      actionHash: "hash-1",
      riskLevel: "medium",
      isPrivileged: true,
      ...action
    },
    context: {
      tenantId: "tenant-a",
      workspaceId: "ws-1",
      sessionId: "session-1",
      skillIds: ["skill-1"],
      artifactIds: ["art-1"],
      latencyMs: 42,
      ...context
    },
    policy: policy ?? {
      policyAvailable: true,
      outcome: "allow",
      responseRiskLevel: "medium",
      tokenVerification: {
        ok: true,
        decisionToken: {
          jti: "jti-1",
          tenantId: "tenant-a",
          workspaceId: "ws-1",
          actionHash: "hash-1",
          expEpochSeconds: 2_000_000_000
        }
      },
      policyDecisionJti: "jti-1",
      policyDecisionToken: "payload.signature"
    },
    jtiRegistry: {
      reserveIfUnused: () => "reserved"
    },
    nowEpochSeconds: 1_900_000_000,
    ...topLevel
  };
}

describe("planRuntimeExecution", () => {
  it("allows non-privileged actions with bypass auditing and no policy token fields", () => {
    const result = planRuntimeExecution(
      buildInput({
        action: {
          isPrivileged: false
        }
      })
    );

    expect(result.status).toBe("allowed");
    expect(result.reasonCode).toBe("non_privileged_bypass");
    expect(result.runtimeTarget).toBe("remote");
    expect(result.dualWritePlan).toEqual({
      writeLocal: true,
      writeRemote: true,
      failClosedOnRemoteFailure: false
    });
    expect(result.outputEvent.policy_result).toBe("allow");
    expect(result.outputEvent.policy_decision_jti).toBeUndefined();
    expect(result.outputEvent.policy_decision_token).toBeUndefined();
  });

  it("omits optional context metadata when not provided", () => {
    const result = planRuntimeExecution({
      tenantClass: "internal",
      localAllowedForTenant: false,
      remoteLedgerEnabled: false,
      action: {
        actionType: "tool_call",
        actionHash: "hash-1",
        riskLevel: "low",
        isPrivileged: false
      },
      context: {
        tenantId: "tenant-a",
        workspaceId: "ws-1",
        sessionId: "session-1"
      },
      policy: {
        policyAvailable: false
      },
      jtiRegistry: {
        reserveIfUnused: () => "reserved"
      }
    });

    expect(result.status).toBe("allowed");
    expect(result.outputEvent.skill_ids).toEqual([]);
    expect(result.outputEvent.artifact_ids).toEqual([]);
    expect(result.outputEvent.latency_ms).toBe(0);
  });

  it("fails closed when policy is unavailable for external medium risk", () => {
    const result = planRuntimeExecution(
      buildInput({
        policy: { policyAvailable: false }
      })
    );

    expect(result.status).toBe("blocked");
    expect(result.reasonCode).toBe("policy_unavailable_fail_closed");
    expect(result.outputEvent.policy_result).toBe("deny");
  });

  it("fails closed when policy is unavailable for external high risk", () => {
    const result = planRuntimeExecution(
      buildInput({
        action: {
          riskLevel: "high"
        },
        policy: { policyAvailable: false }
      })
    );

    expect(result.status).toBe("blocked");
    expect(result.reasonCode).toBe("policy_unavailable_fail_closed");
    expect(result.outputEvent.policy_result).toBe("deny");
  });

  it("fails closed when policy is unavailable for internal high risk", () => {
    const result = planRuntimeExecution(
      buildInput({
        tenantClass: "internal",
        action: {
          riskLevel: "high"
        },
        policy: { policyAvailable: false }
      })
    );

    expect(result.status).toBe("blocked");
    expect(result.reasonCode).toBe("policy_unavailable_fail_closed");
    expect(result.outputEvent.policy_result).toBe("deny");
  });

  it("allows degraded low-risk action when policy is unavailable", () => {
    const result = planRuntimeExecution(
      buildInput({
        action: {
          riskLevel: "low"
        },
        policy: { policyAvailable: false }
      })
    );

    expect(result.status).toBe("allowed");
    expect(result.reasonCode).toBe("degraded_low_risk");
    expect(result.outputEvent.policy_result).toBe("allow");
  });

  it("blocks when policy response risk does not match action risk", () => {
    const jtiRegistry = {
      reserveIfUnused: vi.fn(() => "reserved" as const)
    };

    const result = planRuntimeExecution(
      buildInput({
        policy: {
          policyAvailable: true,
          outcome: "allow",
          responseRiskLevel: "high",
          tokenVerification: {
            ok: true,
            decisionToken: {
              jti: "jti-1",
              tenantId: "tenant-a",
              workspaceId: "ws-1",
              actionHash: "hash-1",
              expEpochSeconds: 2_000_000_000
            }
          },
          policyDecisionJti: "jti-1",
          policyDecisionToken: "payload.signature"
        },
        jtiRegistry
      })
    );

    expect(result.status).toBe("blocked");
    expect(result.reasonCode).toBe("risk_level_mismatch");
    expect(result.outputEvent.policy_result).toBe("deny");
    expect(jtiRegistry.reserveIfUnused).not.toHaveBeenCalled();
  });

  it("blocks when decision token validation fails", () => {
    const jtiRegistry = {
      reserveIfUnused: vi.fn(() => "reserved" as const)
    };

    const result = planRuntimeExecution(
      buildInput({
        policy: {
          policyAvailable: true,
          outcome: "allow",
          responseRiskLevel: "medium",
          tokenVerification: {
            ok: true,
            decisionToken: {
              jti: "jti-1",
              tenantId: "tenant-a",
              workspaceId: "ws-other",
              actionHash: "hash-1",
              expEpochSeconds: 2_000_000_000
            }
          },
          policyDecisionJti: "jti-1",
          policyDecisionToken: "payload.signature"
        },
        jtiRegistry
      })
    );

    expect(result.status).toBe("blocked");
    expect(result.reasonCode).toBe("invalid_decision_token:workspace_mismatch");
    expect(result.outputEvent.policy_result).toBe("deny");
    expect(jtiRegistry.reserveIfUnused).not.toHaveBeenCalled();
  });

  it("blocks replayed decision tokens", () => {
    const jtiRegistry = {
      reserveIfUnused: vi.fn(() => "replayed" as const)
    };

    const result = planRuntimeExecution(
      buildInput({
        jtiRegistry
      })
    );

    expect(result.status).toBe("blocked");
    expect(result.reasonCode).toBe("decision_token_replay");
    expect(result.outputEvent.policy_result).toBe("deny");
    expect(jtiRegistry.reserveIfUnused).toHaveBeenCalledWith("jti-1", 2_000_000_000);
  });

  it("returns error and fails closed when jti registry is unavailable", () => {
    const result = planRuntimeExecution(
      buildInput({
        jtiRegistry: {
          reserveIfUnused: () => "unavailable"
        }
      })
    );

    expect(result.status).toBe("error");
    expect(result.reasonCode).toBe("jti_registry_unavailable");
    expect(result.outputEvent.policy_result).toBe("deny");
  });

  it("blocks privileged policy deny outcomes", () => {
    const result = planRuntimeExecution(
      buildInput({
        policy: {
          policyAvailable: true,
          outcome: "deny",
          responseRiskLevel: "medium",
          tokenVerification: {
            ok: true,
            decisionToken: {
              jti: "jti-1",
              tenantId: "tenant-a",
              workspaceId: "ws-1",
              actionHash: "hash-1",
              expEpochSeconds: 2_000_000_000
            }
          },
          policyDecisionJti: "jti-1",
          policyDecisionToken: "payload.signature"
        }
      })
    );

    expect(result.status).toBe("blocked");
    expect(result.reasonCode).toBe("denied_by_policy");
    expect(result.authorizationReason).toBe("denied_by_policy");
    expect(result.outputEvent.policy_result).toBe("deny");
  });

  it("returns approval required on escalate outcomes", () => {
    const result = planRuntimeExecution(
      buildInput({
        policy: {
          policyAvailable: true,
          outcome: "escalate",
          responseRiskLevel: "medium",
          tokenVerification: {
            ok: true,
            decisionToken: {
              jti: "jti-1",
              tenantId: "tenant-a",
              workspaceId: "ws-1",
              actionHash: "hash-1",
              expEpochSeconds: 2_000_000_000
            }
          },
          policyDecisionJti: "jti-1",
          policyDecisionToken: "payload.signature"
        }
      })
    );

    expect(result.status).toBe("approval_required");
    expect(result.reasonCode).toBe("approval_required");
    expect(result.authorizationReason).toBe("approval_required");
    expect(result.outputEvent.policy_result).toBe("escalate");
  });

  it("blocks when token verification fails before contextual validation", () => {
    const result = planRuntimeExecution(
      buildInput({
        policy: {
          policyAvailable: true,
          outcome: "allow",
          responseRiskLevel: "medium",
          tokenVerification: {
            ok: false,
            reason: "invalid_signature"
          },
          policyDecisionJti: "jti-1",
          policyDecisionToken: "payload.signature"
        }
      })
    );

    expect(result.status).toBe("blocked");
    expect(result.reasonCode).toBe("decision_token_verification_failed:invalid_signature");
    expect(result.outputEvent.policy_result).toBe("deny");
  });

  it("allows privileged actions when policy allows and selects local for internal tenants", () => {
    const result = planRuntimeExecution(
      buildInput({
        tenantClass: "internal",
        localAllowedForTenant: true
      })
    );

    expect(result.status).toBe("allowed");
    expect(result.reasonCode).toBe("allowed");
    expect(result.authorizationReason).toBe("allowed");
    expect(result.runtimeTarget).toBe("local");
    expect(result.outputEvent.runtime_target).toBe("local");
    expect(result.outputEvent.policy_result).toBe("allow");
    expect(result.outputEvent.policy_decision_jti).toBe("jti-1");
    expect(result.outputEvent.policy_decision_token).toBe("payload.signature");
  });
});
