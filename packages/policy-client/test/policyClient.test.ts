import { describe, expect, it } from "vitest";
import {
  createDecisionTokenVerifier,
  decodeDecisionToken,
  defaultDecisionTokenClaimMap,
  requiresHumanApproval,
  validateDecisionToken
} from "../src/policyClient";

function toBase64Url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function buildJwt(payload: Record<string, unknown>): string {
  return `${toBase64Url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${toBase64Url(JSON.stringify(payload))}.sig`;
}

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

  it("rejects malformed token fields", () => {
    expect(
      validateDecisionToken(
        { ...goodToken, expEpochSeconds: Number.NaN } as unknown as typeof goodToken,
        goodContext,
        1_900_000_000
      )
    ).toEqual({
      ok: false,
      reason: "malformed_token"
    });

    expect(
      validateDecisionToken(
        { ...goodToken, workspaceId: " " } as unknown as typeof goodToken,
        goodContext,
        1_900_000_000
      )
    ).toEqual({
      ok: false,
      reason: "malformed_token"
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

describe("decodeDecisionToken", () => {
  it("decodes a valid token with default claim mapping", () => {
    const encoded = buildJwt({
      [defaultDecisionTokenClaimMap.jti]: "jti-1",
      [defaultDecisionTokenClaimMap.exp]: 2_000_000_000,
      [defaultDecisionTokenClaimMap.tenantId]: "tenant-a",
      [defaultDecisionTokenClaimMap.workspaceId]: "ws-1",
      [defaultDecisionTokenClaimMap.actionHash]: "hash-1"
    });

    expect(decodeDecisionToken(encoded)).toEqual({
      ok: true,
      token: {
        jti: "jti-1",
        expEpochSeconds: 2_000_000_000,
        tenantId: "tenant-a",
        workspaceId: "ws-1",
        actionHash: "hash-1"
      }
    });
  });

  it("supports custom claim mapping", () => {
    const encoded = buildJwt({
      jti: "jti-2",
      exp: "2000000001",
      tenant: "tenant-b",
      workspace: "ws-2",
      action: "hash-2"
    });

    expect(
      decodeDecisionToken(encoded, {
        jti: "jti",
        exp: "exp",
        tenantId: "tenant",
        workspaceId: "workspace",
        actionHash: "action"
      })
    ).toEqual({
      ok: true,
      token: {
        jti: "jti-2",
        expEpochSeconds: 2_000_000_001,
        tenantId: "tenant-b",
        workspaceId: "ws-2",
        actionHash: "hash-2"
      }
    });
  });

  it("rejects malformed tokens", () => {
    expect(decodeDecisionToken("bad-token")).toEqual({
      ok: false,
      reason: "malformed_token"
    });
  });

  it("rejects empty encoded token strings", () => {
    expect(decodeDecisionToken(" ")).toEqual({
      ok: false,
      reason: "malformed_token"
    });
  });

  it("rejects tokens with missing payload section", () => {
    expect(decodeDecisionToken("aaa..bbb")).toEqual({
      ok: false,
      reason: "malformed_token"
    });
  });

  it("rejects tokens with non-object payloads", () => {
    const encoded = `${toBase64Url("{}")}.${toBase64Url("123")}.sig`;
    expect(decodeDecisionToken(encoded)).toEqual({
      ok: false,
      reason: "malformed_token"
    });
  });

  it("rejects tokens with invalid payload JSON", () => {
    const encoded = `${toBase64Url("{}")}.@@@.sig`;
    expect(decodeDecisionToken(encoded)).toEqual({
      ok: false,
      reason: "malformed_token"
    });
  });

  it("rejects missing claims", () => {
    const encoded = buildJwt({
      [defaultDecisionTokenClaimMap.jti]: "jti-1"
    });

    expect(decodeDecisionToken(encoded)).toEqual({
      ok: false,
      reason: "missing_claims"
    });
  });

  it("rejects payloads with invalid exp values", () => {
    const encoded = buildJwt({
      [defaultDecisionTokenClaimMap.jti]: "jti-1",
      [defaultDecisionTokenClaimMap.exp]: "not-a-number",
      [defaultDecisionTokenClaimMap.tenantId]: "tenant-a",
      [defaultDecisionTokenClaimMap.workspaceId]: "ws-1",
      [defaultDecisionTokenClaimMap.actionHash]: "hash-1"
    });

    expect(decodeDecisionToken(encoded)).toEqual({
      ok: false,
      reason: "missing_claims"
    });
  });
});

describe("createDecisionTokenVerifier", () => {
  it("returns decoded token when signature callback accepts", async () => {
    const encoded = buildJwt({
      [defaultDecisionTokenClaimMap.jti]: "jti-1",
      [defaultDecisionTokenClaimMap.exp]: 2_000_000_000,
      [defaultDecisionTokenClaimMap.tenantId]: "tenant-a",
      [defaultDecisionTokenClaimMap.workspaceId]: "ws-1",
      [defaultDecisionTokenClaimMap.actionHash]: "hash-1"
    });

    const verifier = createDecisionTokenVerifier({
      validateSignature: async () => true
    });

    await expect(verifier.verifyAndDecode(encoded, defaultDecisionTokenClaimMap)).resolves.toEqual({
      ok: true,
      token: {
        jti: "jti-1",
        expEpochSeconds: 2_000_000_000,
        tenantId: "tenant-a",
        workspaceId: "ws-1",
        actionHash: "hash-1"
      }
    });
  });

  it("returns invalid_signature when signature callback rejects", async () => {
    const encoded = buildJwt({
      [defaultDecisionTokenClaimMap.jti]: "jti-1",
      [defaultDecisionTokenClaimMap.exp]: 2_000_000_000,
      [defaultDecisionTokenClaimMap.tenantId]: "tenant-a",
      [defaultDecisionTokenClaimMap.workspaceId]: "ws-1",
      [defaultDecisionTokenClaimMap.actionHash]: "hash-1"
    });

    const verifier = createDecisionTokenVerifier({
      validateSignature: () => false
    });

    await expect(verifier.verifyAndDecode(encoded, defaultDecisionTokenClaimMap)).resolves.toEqual({
      ok: false,
      reason: "invalid_signature"
    });
  });

  it("passes through decode failures before signature validation", async () => {
    const verifier = createDecisionTokenVerifier({
      validateSignature: () => true
    });

    await expect(verifier.verifyAndDecode("bad-token", defaultDecisionTokenClaimMap)).resolves.toEqual({
      ok: false,
      reason: "malformed_token"
    });
  });
});
