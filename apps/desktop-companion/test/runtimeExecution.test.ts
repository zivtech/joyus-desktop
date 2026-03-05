import { describe, expect, it, vi } from "vitest";

import { createDecisionTokenVerifier, defaultDecisionTokenClaimMap } from "@joyus/policy-client";

import { executeRuntimeAction } from "../src/runtimeExecution";
import type { RuntimeExecutionInput, RuntimeTelemetryEvent } from "../src/runtimeExecution";

function toBase64Url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function buildJwt(payload: Record<string, unknown>): string {
  const header = toBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = toBase64Url(JSON.stringify(payload));
  return `${header}.${body}.sig`;
}

function buildDefaultDecisionToken(actionHash = "hash-1"): string {
  return buildJwt({
    [defaultDecisionTokenClaimMap.jti]: "jti-1",
    [defaultDecisionTokenClaimMap.exp]: 2_000_000_000,
    [defaultDecisionTokenClaimMap.tenantId]: "tenant-a",
    [defaultDecisionTokenClaimMap.workspaceId]: "ws-1",
    [defaultDecisionTokenClaimMap.actionHash]: actionHash
  });
}

function buildInput(overrides: Partial<RuntimeExecutionInput> = {}): RuntimeExecutionInput {
  return {
    controlPlane: {
      baseUrl: "https://control-plane.example.com",
      bearerToken: "tok-1",
      fetchLike: async () => ({
        ok: true,
        status: 200,
        async json() {
          return {};
        },
        async text() {
          return "";
        }
      })
    },
    tenantClass: "external",
    localAllowedForTenant: false,
    remoteLedgerEnabled: true,
    tenantId: "tenant-a",
    workspaceId: "ws-1",
    sessionId: "session-1",
    action: {
      name: "run_command",
      type: "tool_call",
      hash: "hash-1",
      riskLevel: "medium",
      isPrivileged: true
    },
    jtiRegistry: {
      reserveIfUnused: () => "reserved"
    },
    tokenVerifier: createDecisionTokenVerifier(),
    nowEpochSeconds: 1_900_000_000,
    ...overrides
  };
}

function mcpFetch(input: {
  verifyBeforeAction?: {
    status?: number;
    body?: unknown;
    text?: string;
    throwValue?: unknown;
  };
  submitOutput?: {
    status?: number;
    text?: string;
    throwValue?: unknown;
  };
  provenanceByArtifactId?: Record<
    string,
    {
      status?: number;
      body?: unknown;
      text?: string;
      throwValue?: unknown;
    }
  >;
  calls: Array<{ name: string; args: Record<string, unknown> }>;
}) {
  return async (_url: string, init: { body?: string }) => {
    const body = init.body ? (JSON.parse(init.body) as { params?: { name?: string; arguments?: Record<string, unknown> } }) : {};
    const toolName = body.params?.name ?? "";
    const toolArgs = body.params?.arguments ?? {};

    input.calls.push({ name: toolName, args: toolArgs });

    if (toolName === "verify_before_action") {
      if (input.verifyBeforeAction?.throwValue !== undefined) {
        throw input.verifyBeforeAction.throwValue;
      }

      const status = input.verifyBeforeAction?.status ?? 200;
      if (status >= 400) {
        return {
          ok: false,
          status,
          async json() {
            return {};
          },
          async text() {
            return input.verifyBeforeAction?.text ?? "error";
          }
        };
      }

      const payload =
        input.verifyBeforeAction?.body ??
        {
          decision: "allow",
          reason: "ok",
          token: buildDefaultDecisionToken(),
          token_expires_at: "2033-05-18T03:33:20.000Z",
          jti: "jti-1",
          risk_level: "medium"
        };

      return {
        ok: true,
        status: 200,
        async json() {
          return {
            result: {
              content: [{ type: "text", text: JSON.stringify(payload) }]
            }
          };
        },
        async text() {
          return "";
        }
      };
    }

    if (toolName === "submit_output") {
      if (input.submitOutput?.throwValue !== undefined) {
        throw input.submitOutput.throwValue;
      }

      const status = input.submitOutput?.status ?? 200;
      return {
        ok: status < 400,
        status,
        async json() {
          return {};
        },
        async text() {
          return input.submitOutput?.text ?? (status < 400 ? "" : "submit failed");
        }
      };
    }

    if (toolName === "get_provenance") {
      const artifactId = String(toolArgs.artifact_id ?? "");
      const behavior = input.provenanceByArtifactId?.[artifactId];
      if (behavior?.throwValue !== undefined) {
        throw behavior.throwValue;
      }

      const status = behavior?.status ?? 200;
      if (status >= 400) {
        return {
          ok: false,
          status,
          async json() {
            return {};
          },
          async text() {
            return behavior?.text ?? "provenance error";
          }
        };
      }

      const provenanceBody =
        behavior?.body ??
        {
          artifact: {
            artifact_id: artifactId,
            tenant_id: "tenant-a",
            workspace_id: "ws-1",
            session_id: "session-1"
          },
          related_events: []
        };

      return {
        ok: true,
        status: 200,
        async json() {
          return {
            result: {
              content: [{ type: "text", text: JSON.stringify(provenanceBody) }]
            }
          };
        },
        async text() {
          return "";
        }
      };
    }

    return {
      ok: false,
      status: 500,
      async json() {
        return {};
      },
      async text() {
        return "unknown tool";
      }
    };
  };
}

describe("executeRuntimeAction", () => {
  it("executes allowed privileged action and submits output", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const executeAction = vi.fn(async () => ({
      skillIds: ["skill-x"],
      artifactIds: ["art-x"],
      latencyMs: 99
    }));

    const result = await executeRuntimeAction(
      buildInput({
        controlPlane: {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          fetchLike: mcpFetch({ calls })
        },
        provenance: {
          mode: "off"
        },
        executeAction
      })
    );

    expect(result.status).toBe("allowed");
    expect(result.outputSubmitted).toBe(true);
    expect(result.actionExecuted).toBe(true);
    expect(executeAction).toHaveBeenCalledWith("remote");
    expect(calls.map((call) => call.name)).toEqual(["verify_before_action", "submit_output"]);
    expect(calls[1]?.args.skill_ids).toEqual(["skill-x"]);
    expect(calls[1]?.args.artifact_ids).toEqual(["art-x"]);
    expect(calls[1]?.args.latency_ms).toBe(99);
  });

  it("forwards optional action target/details/metadata to policy request", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];

    const result = await executeRuntimeAction(
      buildInput({
        action: {
          name: "run_command",
          type: "tool_call",
          hash: "hash-1",
          riskLevel: "medium",
          isPrivileged: true,
          target: "terminal",
          details: { cmd: "ls -la" },
          metadata: { source: "desktop" }
        },
        controlPlane: {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          fetchLike: mcpFetch({ calls })
        }
      })
    );

    expect(result.status).toBe("allowed");
    expect(calls[0]?.name).toBe("verify_before_action");
    expect(calls[0]?.args.target).toBe("terminal");
    expect(calls[0]?.args.details).toEqual({ cmd: "ls -la" });
    expect(calls[0]?.args.metadata).toEqual({ source: "desktop" });
  });

  it("bypasses policy for non-privileged actions", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];

    const result = await executeRuntimeAction(
      buildInput({
        action: {
          name: "read_file",
          type: "tool_call",
          hash: "hash-read",
          riskLevel: "low",
          isPrivileged: false
        },
        controlPlane: {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          fetchLike: mcpFetch({ calls })
        }
      })
    );

    expect(result.status).toBe("allowed");
    expect(result.reasonCode).toBe("non_privileged_bypass");
    expect(result.outputSubmitted).toBe(true);
    expect(calls.map((call) => call.name)).toEqual(["submit_output"]);
  });

  it("supports omitted nowEpochSeconds input", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];

    const result = await executeRuntimeAction({
      controlPlane: {
        baseUrl: "https://control-plane.example.com",
        bearerToken: "tok-1",
        fetchLike: mcpFetch({ calls })
      },
      tenantClass: "internal",
      localAllowedForTenant: false,
      remoteLedgerEnabled: false,
      tenantId: "tenant-a",
      workspaceId: "ws-1",
      sessionId: "session-1",
      action: {
        name: "read_file",
        type: "tool_call",
        hash: "hash-read",
        riskLevel: "low",
        isPrivileged: false
      },
      jtiRegistry: {
        reserveIfUnused: () => "reserved"
      },
      tokenVerifier: createDecisionTokenVerifier()
    });

    expect(result.status).toBe("allowed");
    expect(result.outputSubmitted).toBe(true);
    expect(calls.map((call) => call.name)).toEqual(["submit_output"]);
  });

  it("falls back to policy-unavailable path when policy call fails", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];

    const result = await executeRuntimeAction(
      buildInput({
        controlPlane: {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          fetchLike: mcpFetch({
            calls,
            verifyBeforeAction: {
              status: 502,
              text: "bad gateway"
            }
          })
        }
      })
    );

    expect(result.status).toBe("blocked");
    expect(result.reasonCode).toBe("policy_unavailable_fail_closed");
    expect(result.outputSubmitted).toBe(true);
    expect(calls.map((call) => call.name)).toEqual(["verify_before_action", "submit_output"]);
  });

  it("handles non-Error policy request failures", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];

    const result = await executeRuntimeAction(
      buildInput({
        controlPlane: {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          fetchLike: mcpFetch({
            calls,
            verifyBeforeAction: {
              throwValue: "policy transport down"
            }
          })
        }
      })
    );

    expect(result.status).toBe("blocked");
    expect(result.reasonCode).toBe("policy_unavailable_fail_closed");
    expect(result.outputSubmitted).toBe(true);
  });

  it("blocks when token verifier rejects signature", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];

    const result = await executeRuntimeAction(
      buildInput({
        tokenVerifier: createDecisionTokenVerifier({
          validateSignature: () => false
        }),
        controlPlane: {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          fetchLike: mcpFetch({ calls })
        }
      })
    );

    expect(result.status).toBe("blocked");
    expect(result.reasonCode).toBe("decision_token_verification_failed:invalid_signature");
    expect(result.outputSubmitted).toBe(true);
  });

  it("supports custom token claim maps", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const token = buildJwt({
      jti: "jti-2",
      exp: 2_000_000_001,
      tenant: "tenant-a",
      workspace: "ws-1",
      action: "hash-1"
    });

    const result = await executeRuntimeAction(
      buildInput({
        tokenClaimMap: {
          jti: "jti",
          exp: "exp",
          tenantId: "tenant",
          workspaceId: "workspace",
          actionHash: "action"
        },
        controlPlane: {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          fetchLike: mcpFetch({
            calls,
            verifyBeforeAction: {
              body: {
                decision: "allow",
                reason: "ok",
                token,
                token_expires_at: "2033-05-18T03:33:20.000Z",
                jti: "jti-2",
                risk_level: "medium"
              }
            }
          })
        }
      })
    );

    expect(result.status).toBe("allowed");
    expect(result.outputSubmitted).toBe(true);
  });

  it("returns error when action execution fails and still submits output", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];

    const result = await executeRuntimeAction(
      buildInput({
        controlPlane: {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          fetchLike: mcpFetch({ calls })
        },
        executeAction: async () => {
          throw new Error("runner crashed");
        }
      })
    );

    expect(result.status).toBe("error");
    expect(result.reasonCode).toBe("action_execution_failed");
    expect(result.actionExecuted).toBe(false);
    expect(result.actionError).toBe("runner crashed");
    expect(result.outputSubmitted).toBe(true);
  });

  it("handles non-Error execution throws and preserves message text", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];

    const result = await executeRuntimeAction(
      buildInput({
        controlPlane: {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          fetchLike: mcpFetch({ calls })
        },
        executeAction: async () => {
          throw "runner panic";
        }
      })
    );

    expect(result.status).toBe("error");
    expect(result.reasonCode).toBe("action_execution_failed");
    expect(result.actionError).toBe("runner panic");
    expect(result.outputSubmitted).toBe(true);
  });

  it("fails closed when output submission fails for external privileged action", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];

    const result = await executeRuntimeAction(
      buildInput({
        controlPlane: {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          fetchLike: mcpFetch({
            calls,
            submitOutput: {
              status: 500,
              text: "ledger down"
            }
          })
        }
      })
    );

    expect(result.status).toBe("error");
    expect(result.reasonCode).toBe("output_submit_failed_fail_closed");
    expect(result.outputSubmitted).toBe(false);
    expect(result.outputSubmissionError).toContain("ledger down");
  });

  it("retains action and provenance data on fail-closed submit failures", async () => {
    const result = await executeRuntimeAction(
      buildInput({
        executeAction: async () => ({
          artifactIds: ["art-1"],
          skillIds: ["skill-a"]
        }),
        provenance: {
          mode: "audit"
        },
        controlPlane: {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          fetchLike: mcpFetch({
            calls: [],
            submitOutput: {
              status: 500,
              text: "ledger down"
            }
          })
        }
      })
    );

    expect(result.status).toBe("error");
    expect(result.reasonCode).toBe("output_submit_failed_fail_closed");
    expect(result.actionResult).toEqual({
      artifactIds: ["art-1"],
      skillIds: ["skill-a"]
    });
    expect(result.provenanceReport?.checkedArtifactIds).toEqual(["art-1"]);
    expect(result.outputSubmitted).toBe(false);
  });

  it("retains action error on fail-closed submit failures", async () => {
    const result = await executeRuntimeAction(
      buildInput({
        executeAction: async () => {
          throw "runner stopped";
        },
        controlPlane: {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          fetchLike: mcpFetch({
            calls: [],
            submitOutput: {
              status: 500,
              text: "ledger down"
            }
          })
        }
      })
    );

    expect(result.status).toBe("error");
    expect(result.reasonCode).toBe("output_submit_failed_fail_closed");
    expect(result.actionError).toBe("runner stopped");
    expect(result.outputSubmitted).toBe(false);
  });

  it("keeps original status when output submission fails for non-fail-closed path", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];

    const result = await executeRuntimeAction(
      buildInput({
        tenantClass: "internal",
        action: {
          name: "read_file",
          type: "tool_call",
          hash: "hash-read",
          riskLevel: "low",
          isPrivileged: false
        },
        controlPlane: {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          fetchLike: mcpFetch({
            calls,
            submitOutput: {
              status: 500,
              text: "ledger down"
            }
          })
        }
      })
    );

    expect(result.status).toBe("allowed");
    expect(result.reasonCode).toBe("non_privileged_bypass");
    expect(result.outputSubmitted).toBe(false);
    expect(result.outputSubmissionError).toContain("ledger down");
    expect(calls.map((call) => call.name)).toEqual(["submit_output"]);
  });

  it("retains action and provenance data on non-fail-closed submit failures", async () => {
    const result = await executeRuntimeAction(
      buildInput({
        tenantClass: "internal",
        executeAction: async () => ({
          artifactIds: ["art-1"],
          skillIds: ["skill-a"]
        }),
        provenance: {
          mode: "audit"
        },
        controlPlane: {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          fetchLike: mcpFetch({
            calls: [],
            submitOutput: {
              status: 500,
              text: "ledger down"
            }
          })
        }
      })
    );

    expect(result.status).toBe("allowed");
    expect(result.actionResult).toEqual({
      artifactIds: ["art-1"],
      skillIds: ["skill-a"]
    });
    expect(result.provenanceReport?.checkedArtifactIds).toEqual(["art-1"]);
    expect(result.outputSubmitted).toBe(false);
  });

  it("retains action error on non-fail-closed submit failures", async () => {
    const result = await executeRuntimeAction(
      buildInput({
        tenantClass: "internal",
        executeAction: async () => {
          throw "runner stopped";
        },
        controlPlane: {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          fetchLike: mcpFetch({
            calls: [],
            submitOutput: {
              status: 500,
              text: "ledger down"
            }
          })
        }
      })
    );

    expect(result.status).toBe("error");
    expect(result.reasonCode).toBe("action_execution_failed");
    expect(result.actionError).toBe("runner stopped");
    expect(result.outputSubmitted).toBe(false);
  });

  it("supports non-Error submit failures", async () => {
    const fetchLike = async (_url: string, init: { body?: string }) => {
      const body = init.body ? (JSON.parse(init.body) as { params?: { name?: string } }) : {};
      const toolName = body.params?.name;

      if (toolName === "submit_output") {
        throw "transport down";
      }

      return {
        ok: true,
        status: 200,
        async json() {
          return {
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    decision: "allow",
                    reason: "ok",
                    token: buildDefaultDecisionToken(),
                    token_expires_at: "2033-05-18T03:33:20.000Z",
                    jti: "jti-1",
                    risk_level: "medium"
                  })
                }
              ]
            }
          };
        },
        async text() {
          return "";
        }
      };
    };

    const result = await executeRuntimeAction(
      buildInput({
        tenantClass: "internal",
        action: {
          name: "read_file",
          type: "tool_call",
          hash: "hash-read",
          riskLevel: "low",
          isPrivileged: false
        },
        controlPlane: {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          fetchLike
        }
      })
    );

    expect(result.status).toBe("allowed");
    expect(result.outputSubmitted).toBe(false);
    expect(result.outputSubmissionError).toBe("transport down");
  });

  it("applies provenance checks in audit mode without blocking", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];

    const result = await executeRuntimeAction(
      buildInput({
        executeAction: async () => ({
          artifactIds: ["art-1", "art-2"],
          skillIds: ["skill-1"]
        }),
        provenance: {
          mode: "audit"
        },
        controlPlane: {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          fetchLike: mcpFetch({
            calls,
            provenanceByArtifactId: {
              "art-2": {
                body: {
                  artifact: {
                    artifact_id: "wrong",
                    tenant_id: "tenant-a",
                    workspace_id: "ws-1",
                    session_id: "session-1"
                  },
                  related_events: []
                }
              }
            }
          })
        }
      })
    );

    expect(result.status).toBe("allowed");
    expect(result.provenanceReport).toEqual({
      mode: "audit",
      checkedArtifactIds: ["art-1", "art-2"],
      failedArtifactIds: ["art-2"]
    });
    expect(calls.map((call) => call.name)).toEqual([
      "verify_before_action",
      "get_provenance",
      "get_provenance",
      "submit_output"
    ]);
  });

  it("handles action results without artifactIds in provenance checks", async () => {
    const result = await executeRuntimeAction(
      buildInput({
        executeAction: async () => ({
          skillIds: ["skill-1"]
        }),
        provenance: {
          mode: "audit"
        },
        controlPlane: {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          fetchLike: mcpFetch({
            calls: []
          })
        }
      })
    );

    expect(result.status).toBe("allowed");
    expect(result.provenanceReport).toEqual({
      mode: "audit",
      checkedArtifactIds: [],
      failedArtifactIds: []
    });
  });

  it("uses artifactIdSelector when provided", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];

    const result = await executeRuntimeAction(
      buildInput({
        executeAction: async () => ({
          artifactIds: ["ignored-id"],
          skillIds: ["skill-1"]
        }),
        provenance: {
          mode: "audit",
          artifactIdSelector: () => ["selected-1"]
        },
        controlPlane: {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          fetchLike: mcpFetch({ calls })
        }
      })
    );

    expect(result.status).toBe("allowed");
    expect(result.provenanceReport).toEqual({
      mode: "audit",
      checkedArtifactIds: ["selected-1"],
      failedArtifactIds: []
    });
    expect(calls.map((call) => call.name)).toEqual(["verify_before_action", "get_provenance", "submit_output"]);
    expect(calls[1]?.args.artifact_id).toBe("selected-1");
  });

  it("enforces provenance mismatches when mode is enforce", async () => {
    const result = await executeRuntimeAction(
      buildInput({
        executeAction: async () => ({
          artifactIds: ["art-1"]
        }),
        provenance: {
          mode: "enforce"
        },
        controlPlane: {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          fetchLike: mcpFetch({
            calls: [],
            provenanceByArtifactId: {
              "art-1": {
                body: {
                  artifact: {
                    artifact_id: "art-1",
                    tenant_id: "tenant-b",
                    workspace_id: "ws-1",
                    session_id: "session-1"
                  },
                  related_events: []
                }
              }
            }
          })
        }
      })
    );

    expect(result.status).toBe("error");
    expect(result.reasonCode).toBe("provenance_verification_failed");
  });

  it("enforces provenance lookup failures when mode is enforce", async () => {
    const result = await executeRuntimeAction(
      buildInput({
        executeAction: async () => ({
          artifactIds: ["art-1"]
        }),
        provenance: {
          mode: "enforce"
        },
        controlPlane: {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          fetchLike: mcpFetch({
            calls: [],
            provenanceByArtifactId: {
              "art-1": {
                status: 500,
                text: "down"
              }
            }
          })
        }
      })
    );

    expect(result.status).toBe("error");
    expect(result.reasonCode).toBe("provenance_lookup_failed");
  });

  it("enforces provenance mismatches when artifact payload is missing", async () => {
    const result = await executeRuntimeAction(
      buildInput({
        executeAction: async () => ({
          artifactIds: ["art-1"]
        }),
        provenance: {
          mode: "enforce"
        },
        controlPlane: {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          fetchLike: mcpFetch({
            calls: [],
            provenanceByArtifactId: {
              "art-1": {
                body: {}
              }
            }
          })
        }
      })
    );

    expect(result.status).toBe("error");
    expect(result.reasonCode).toBe("provenance_verification_failed");
  });

  it("enforces workspace mismatches when mode is enforce", async () => {
    const result = await executeRuntimeAction(
      buildInput({
        executeAction: async () => ({
          artifactIds: ["art-1"]
        }),
        provenance: {
          mode: "enforce"
        },
        controlPlane: {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          fetchLike: mcpFetch({
            calls: [],
            provenanceByArtifactId: {
              "art-1": {
                body: {
                  artifact: {
                    artifact_id: "art-1",
                    tenant_id: "tenant-a",
                    workspace_id: "ws-other",
                    session_id: "session-1"
                  }
                }
              }
            }
          })
        }
      })
    );

    expect(result.status).toBe("error");
    expect(result.reasonCode).toBe("provenance_verification_failed");
  });

  it("enforces session mismatches when mode is enforce", async () => {
    const result = await executeRuntimeAction(
      buildInput({
        executeAction: async () => ({
          artifactIds: ["art-1"]
        }),
        provenance: {
          mode: "enforce"
        },
        controlPlane: {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          fetchLike: mcpFetch({
            calls: [],
            provenanceByArtifactId: {
              "art-1": {
                body: {
                  artifact: {
                    artifact_id: "art-1",
                    tenant_id: "tenant-a",
                    workspace_id: "ws-1",
                    session_id: "session-other"
                  }
                }
              }
            }
          })
        }
      })
    );

    expect(result.status).toBe("error");
    expect(result.reasonCode).toBe("provenance_verification_failed");
  });

  it("accepts provenance records with optional missing identity fields", async () => {
    const result = await executeRuntimeAction(
      buildInput({
        executeAction: async () => ({
          artifactIds: ["art-1"]
        }),
        provenance: {
          mode: "audit"
        },
        controlPlane: {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          fetchLike: mcpFetch({
            calls: [],
            provenanceByArtifactId: {
              "art-1": {
                body: {
                  artifact: {
                    artifact_id: "art-1"
                  }
                }
              }
            }
          })
        }
      })
    );

    expect(result.status).toBe("allowed");
    expect(result.provenanceReport?.failedArtifactIds).toEqual([]);
  });

  it("skips provenance lookups when mode is off", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];

    const result = await executeRuntimeAction(
      buildInput({
        executeAction: async () => ({
          artifactIds: ["art-1"]
        }),
        provenance: {
          mode: "off"
        },
        controlPlane: {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          fetchLike: mcpFetch({ calls })
        }
      })
    );

    expect(result.status).toBe("allowed");
    expect(calls.map((call) => call.name)).toEqual(["verify_before_action", "submit_output"]);
  });

  it("emits telemetry events and ignores sink failures", async () => {
    const events: RuntimeTelemetryEvent[] = [];

    const result = await executeRuntimeAction(
      buildInput({
        action: {
          name: "read_file",
          type: "tool_call",
          hash: "hash-read",
          riskLevel: "low",
          isPrivileged: false
        },
        telemetrySink: {
          record: async (event) => {
            events.push(event);
            if (event.name === "output_submit_started") {
              throw new Error("telemetry down");
            }
          }
        },
        controlPlane: {
          baseUrl: "https://control-plane.example.com",
          bearerToken: "tok-1",
          fetchLike: mcpFetch({ calls: [] })
        }
      })
    );

    expect(result.status).toBe("allowed");
    expect(events.some((event) => event.name === "decision_planned")).toBe(true);
    expect(events.some((event) => event.name === "output_submit_started")).toBe(true);
  });
});
