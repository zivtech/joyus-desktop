import { describe, expect, it } from "vitest";
import { requiresHumanApproval, validateDecisionToken } from "../src/policyClient";

describe("validateDecisionToken", () => {
  const goodToken = {
    jti: "jti-1",
    tenantId: "tenant-a",
    workspaceId: "ws-1",
    actionHash: "abc123",
    expEpochSeconds: 2_000_000_000
  };

  const goodContext = {
    tenantId: "tenant-a",
    workspaceId: "ws-1",
    actionHash: "abc123"
  };

  it("accepts a valid token", () => {
    expect(validateDecisionToken(goodToken, goodContext, 1_900_000_000)).toEqual({ ok: true });
  });

  it("rejects token with missing jti", () => {
    expect(validateDecisionToken({ ...goodToken, jti: " " }, goodContext, 1_900_000_000)).toEqual({
      ok: false,
      reason: "missing_jti"
    });
  });

  it("rejects expired token", () => {
    expect(validateDecisionToken(goodToken, goodContext, 2_000_000_000)).toEqual({
      ok: false,
      reason: "expired"
    });
  });

  it("rejects tenant mismatch", () => {
    expect(validateDecisionToken(goodToken, { ...goodContext, tenantId: "tenant-b" }, 1_900_000_000)).toEqual({
      ok: false,
      reason: "tenant_mismatch"
    });
  });

  it("rejects workspace mismatch", () => {
    expect(validateDecisionToken(goodToken, { ...goodContext, workspaceId: "ws-2" }, 1_900_000_000)).toEqual({
      ok: false,
      reason: "workspace_mismatch"
    });
  });

  it("rejects action hash mismatch", () => {
    expect(validateDecisionToken(goodToken, { ...goodContext, actionHash: "zzz" }, 1_900_000_000)).toEqual({
      ok: false,
      reason: "action_mismatch"
    });
  });
});

describe("requiresHumanApproval", () => {
  it("requires approval on escalate", () => {
    expect(requiresHumanApproval("low", "escalate")).toBe(true);
  });

  it("requires approval on high risk even if allow", () => {
    expect(requiresHumanApproval("high", "allow")).toBe(true);
  });

  it("does not require approval on low allow", () => {
    expect(requiresHumanApproval("low", "allow")).toBe(false);
  });
});
