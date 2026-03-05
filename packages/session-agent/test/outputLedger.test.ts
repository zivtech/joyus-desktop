import { describe, expect, it } from "vitest";

import { buildOutputEvent, planDualWrite, sendOutputEvent } from "../src/outputLedger";

describe("buildOutputEvent", () => {
  it("maps output metadata to control-plane event shape", () => {
    expect(
      buildOutputEvent({
        tenantId: "tenant-a",
        workspaceId: "ws-1",
        sessionId: "session-1",
        actionType: "tool_call",
        riskLevel: "medium",
        policyResult: "allow",
        runtimeTarget: "remote",
        skillIds: ["drupal-security"],
        artifactIds: ["art-1"],
        latencyMs: 42,
        policyDecisionJti: "jti-1",
        policyDecisionToken: "payload.signature"
      })
    ).toEqual({
      tenant_id: "tenant-a",
      workspace_id: "ws-1",
      session_id: "session-1",
      action_type: "tool_call",
      risk_level: "medium",
      policy_result: "allow",
      runtime_target: "remote",
      skill_ids: ["drupal-security"],
      artifact_ids: ["art-1"],
      latency_ms: 42,
      policy_decision_jti: "jti-1",
      policy_decision_token: "payload.signature"
    });
  });

  it("defaults optional fields when omitted", () => {
    expect(
      buildOutputEvent({
        tenantId: "tenant-a",
        workspaceId: "ws-1",
        sessionId: "session-1",
        actionType: "tool_call",
        riskLevel: "low",
        policyResult: "allow",
        runtimeTarget: "local",
        policyDecisionJti: "jti-2",
        policyDecisionToken: "payload.signature"
      })
    ).toEqual({
      tenant_id: "tenant-a",
      workspace_id: "ws-1",
      session_id: "session-1",
      action_type: "tool_call",
      risk_level: "low",
      policy_result: "allow",
      runtime_target: "local",
      skill_ids: [],
      artifact_ids: [],
      latency_ms: 0,
      policy_decision_jti: "jti-2",
      policy_decision_token: "payload.signature"
    });
  });
});

describe("planDualWrite", () => {
  it("always dual-writes privileged actions and fails closed for external tenants", () => {
    expect(planDualWrite("external", true, false)).toEqual({
      writeLocal: true,
      writeRemote: true,
      failClosedOnRemoteFailure: true
    });
  });

  it("dual-writes privileged internal actions without external fail-closed", () => {
    expect(planDualWrite("internal", true, false)).toEqual({
      writeLocal: true,
      writeRemote: true,
      failClosedOnRemoteFailure: false
    });
  });

  it("uses remote setting for non-privileged actions", () => {
    expect(planDualWrite("internal", false, true)).toEqual({
      writeLocal: true,
      writeRemote: true,
      failClosedOnRemoteFailure: false
    });

    expect(planDualWrite("internal", false, false)).toEqual({
      writeLocal: true,
      writeRemote: false,
      failClosedOnRemoteFailure: false
    });
  });
});

describe("sendOutputEvent", () => {
  it("submits output through MCP submit_output tool", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];

    const fetchLike = async (url: string, init: { body?: string }) => {
      requests.push({
        url,
        body: init.body ? JSON.parse(init.body) : null
      });

      return {
        ok: true,
        status: 200,
        async text() {
          return "";
        }
      };
    };

    await expect(
      sendOutputEvent(fetchLike, {
        baseUrl: "https://control-plane.example.com/",
        bearerToken: "tok-1",
        event: buildOutputEvent({
          tenantId: "tenant-a",
          workspaceId: "ws-1",
          sessionId: "session-1",
          actionType: "tool_call",
          riskLevel: "low",
          policyResult: "allow",
          runtimeTarget: "remote",
          policyDecisionJti: "jti-1",
          policyDecisionToken: "payload.signature"
        })
      })
    ).resolves.toBeUndefined();

    expect(requests[0]?.url).toBe("https://control-plane.example.com/mcp");
    expect(requests[0]?.body).toEqual({
      jsonrpc: "2.0",
      id: "cp-tool-1",
      method: "tools/call",
      params: {
        name: "submit_output",
        arguments: {
          tenant_id: "tenant-a",
          workspace_id: "ws-1",
          session_id: "session-1",
          action_type: "tool_call",
          risk_level: "low",
          policy_result: "allow",
          runtime_target: "remote",
          skill_ids: [],
          artifact_ids: [],
          latency_ms: 0,
          policy_decision_jti: "jti-1",
          policy_decision_token: "payload.signature"
        }
      }
    });
  });

  it("throws when MCP submit_output fails", async () => {
    const fetchLike = async () => ({
      ok: false,
      status: 500,
      async text() {
        return "ledger down";
      }
    });

    await expect(
      sendOutputEvent(fetchLike, {
        baseUrl: "https://control-plane.example.com",
        bearerToken: "tok-1",
        event: buildOutputEvent({
          tenantId: "tenant-a",
          workspaceId: "ws-1",
          sessionId: "session-1",
          actionType: "tool_call",
          riskLevel: "low",
          policyResult: "allow",
          runtimeTarget: "remote",
          policyDecisionJti: "jti-1",
          policyDecisionToken: "payload.signature"
        })
      })
    ).rejects.toThrow("MCP submit_output failed (500): ledger down");
  });
});
