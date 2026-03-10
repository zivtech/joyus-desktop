import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import {
  requestHandoffAuthorization,
  type HandoffAuthParams,
} from "../src/handoffAuthorization";
import { HandoffError } from "@joyus/policy-client";
import * as policyClientModule from "@joyus/policy-client";

vi.mock("@joyus/policy-client", async (importOriginal) => {
  const actual = await importOriginal<typeof policyClientModule>();
  return {
    ...actual,
    requestPolicyDecision: vi.fn(),
  };
});

const mockRequestPolicyDecision =
  policyClientModule.requestPolicyDecision as Mock;

const baseFetchLike = vi.fn();

const baseParams: HandoffAuthParams = {
  session_id: "sess-abc",
  tenant_id: "tenant-xyz",
  workspace_id: "ws-123",
  fetchLike: baseFetchLike,
  baseUrl: "https://control.example.com",
  bearerToken: "token-secret",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requestHandoffAuthorization", () => {
  it("returns allow result with policy_token and token_expires_at on allow response", async () => {
    mockRequestPolicyDecision.mockResolvedValueOnce({
      decision: "allow",
      reason: "permitted",
      token: "header.payload.sig",
      token_expires_at: "2026-03-10T12:00:00Z",
      jti: "jti-001",
      risk_level: "medium",
    });

    const result = await requestHandoffAuthorization(baseParams);

    expect(result).toEqual({
      decision: "allow",
      policy_token: "header.payload.sig",
      token_expires_at: "2026-03-10T12:00:00Z",
    });
  });

  it("throws HandoffError with POLICY_DENIED on deny response", async () => {
    mockRequestPolicyDecision.mockResolvedValueOnce({
      decision: "deny",
      reason: "not allowed by policy",
      token: "header.payload.sig",
      token_expires_at: "2026-03-10T12:00:00Z",
      jti: "jti-002",
      risk_level: "medium",
    });

    await expect(requestHandoffAuthorization(baseParams)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(HandoffError);
        const handoffErr = err as HandoffError;
        expect(handoffErr.code).toBe("POLICY_DENIED");
        expect(handoffErr.message).toContain("not allowed by policy");
        return true;
      }
    );
  });

  it("throws HandoffError with POLICY_ESCALATED on escalate response", async () => {
    mockRequestPolicyDecision.mockResolvedValueOnce({
      decision: "escalate",
      reason: "requires manual approval",
      token: "header.payload.sig",
      token_expires_at: "2026-03-10T12:00:00Z",
      jti: "jti-003",
      risk_level: "medium",
    });

    await expect(requestHandoffAuthorization(baseParams)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(HandoffError);
        const handoffErr = err as HandoffError;
        expect(handoffErr.code).toBe("POLICY_ESCALATED");
        expect(handoffErr.message).toContain("requires manual approval");
        return true;
      }
    );
  });

  it("throws HandoffError with POLICY_UNAVAILABLE on network error", async () => {
    mockRequestPolicyDecision.mockRejectedValueOnce(
      new Error("connect ECONNREFUSED")
    );

    await expect(requestHandoffAuthorization(baseParams)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(HandoffError);
        const handoffErr = err as HandoffError;
        expect(handoffErr.code).toBe("POLICY_UNAVAILABLE");
        expect(handoffErr.message).toContain("connect ECONNREFUSED");
        return true;
      }
    );
  });

  it("throws HandoffError with POLICY_UNAVAILABLE on timeout error", async () => {
    mockRequestPolicyDecision.mockRejectedValueOnce(
      new Error("Request timed out after 5000ms")
    );

    await expect(requestHandoffAuthorization(baseParams)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(HandoffError);
        const handoffErr = err as HandoffError;
        expect(handoffErr.code).toBe("POLICY_UNAVAILABLE");
        expect(handoffErr.message).toContain("Request timed out after 5000ms");
        return true;
      }
    );
  });

  it("throws HandoffError with POLICY_UNAVAILABLE on malformed/parse error", async () => {
    mockRequestPolicyDecision.mockRejectedValueOnce(
      new Error("Invalid policy decision response: decision")
    );

    await expect(requestHandoffAuthorization(baseParams)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(HandoffError);
        const handoffErr = err as HandoffError;
        expect(handoffErr.code).toBe("POLICY_UNAVAILABLE");
        expect(handoffErr.message).toContain(
          "Invalid policy decision response: decision"
        );
        return true;
      }
    );
  });

  it("passes action_name=session_handoff, risk_level=medium, and session fields through to requestPolicyDecision", async () => {
    mockRequestPolicyDecision.mockResolvedValueOnce({
      decision: "allow",
      reason: "ok",
      token: "h.p.s",
      token_expires_at: "2026-03-10T12:00:00Z",
      jti: "jti-007",
      risk_level: "medium",
    });

    await requestHandoffAuthorization(baseParams);

    expect(mockRequestPolicyDecision).toHaveBeenCalledOnce();
    const [, callInput] = mockRequestPolicyDecision.mock.calls[0] as [
      unknown,
      { request: { action: { name: string; risk_level: string }; session: { session_id: string; tenant_id: string; workspace_id?: string } } }
    ];
    expect(callInput.request.action.name).toBe("session_handoff");
    expect(callInput.request.action.risk_level).toBe("medium");
    expect(callInput.request.session.session_id).toBe("sess-abc");
    expect(callInput.request.session.tenant_id).toBe("tenant-xyz");
    expect(callInput.request.session.workspace_id).toBe("ws-123");
  });

  it("fails closed (POLICY_UNAVAILABLE) for internal tenant when policy service throws", async () => {
    mockRequestPolicyDecision.mockRejectedValueOnce(
      new Error("internal server error")
    );

    const internalParams: HandoffAuthParams = {
      ...baseParams,
      tenant_id: "internal-tenant",
    };

    await expect(
      requestHandoffAuthorization(internalParams)
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(HandoffError);
      const handoffErr = err as HandoffError;
      expect(handoffErr.code).toBe("POLICY_UNAVAILABLE");
      return true;
    });
  });

  it("fails closed (POLICY_UNAVAILABLE) for external tenant when policy service throws", async () => {
    mockRequestPolicyDecision.mockRejectedValueOnce(
      new Error("connection refused")
    );

    const externalParams: HandoffAuthParams = {
      ...baseParams,
      tenant_id: "external-tenant-corp",
    };

    await expect(
      requestHandoffAuthorization(externalParams)
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(HandoffError);
      const handoffErr = err as HandoffError;
      expect(handoffErr.code).toBe("POLICY_UNAVAILABLE");
      return true;
    });
  });

  it("throws HandoffError with POLICY_UNAVAILABLE when a non-Error value is thrown", async () => {
    mockRequestPolicyDecision.mockRejectedValueOnce("plain string error");

    await expect(requestHandoffAuthorization(baseParams)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(HandoffError);
        const handoffErr = err as HandoffError;
        expect(handoffErr.code).toBe("POLICY_UNAVAILABLE");
        expect(handoffErr.message).toContain("plain string error");
        return true;
      }
    );
  });

  it("throws HandoffError with POLICY_UNAVAILABLE on unexpected decision value", async () => {
    mockRequestPolicyDecision.mockResolvedValueOnce({
      decision: "unknown_future_value" as unknown,
      reason: "something new",
      token: "h.p.s",
      token_expires_at: "2026-03-10T12:00:00Z",
      jti: "jti-999",
      risk_level: "medium",
    });

    await expect(requestHandoffAuthorization(baseParams)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(HandoffError);
        const handoffErr = err as HandoffError;
        expect(handoffErr.code).toBe("POLICY_UNAVAILABLE");
        expect(handoffErr.message).toContain("unknown_future_value");
        return true;
      }
    );
  });
});
