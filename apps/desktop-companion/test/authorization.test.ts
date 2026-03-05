import { describe, expect, it } from "vitest";
import { authorizeAction } from "../src/authorization";

describe("authorizeAction", () => {
  it("allows low-risk degraded mode when policy unavailable", () => {
    expect(
      authorizeAction({
        riskLevel: "low",
        outcome: "allow",
        policyAvailable: false,
        externalTenant: false
      })
    ).toEqual({
      allowed: true,
      needsApproval: false,
      reason: "degraded_low_risk"
    });
  });

  it("fails closed for external medium/high when policy unavailable", () => {
    expect(
      authorizeAction({
        riskLevel: "medium",
        outcome: "allow",
        policyAvailable: false,
        externalTenant: true
      })
    ).toEqual({
      allowed: false,
      needsApproval: false,
      reason: "policy_unavailable_fail_closed"
    });
  });

  it("fails closed for internal high when policy unavailable", () => {
    expect(
      authorizeAction({
        riskLevel: "high",
        outcome: "allow",
        policyAvailable: false,
        externalTenant: false
      })
    ).toEqual({
      allowed: false,
      needsApproval: false,
      reason: "policy_unavailable_fail_closed"
    });
  });

  it("denies when policy outcome is deny", () => {
    expect(
      authorizeAction({
        riskLevel: "low",
        outcome: "deny",
        policyAvailable: true,
        externalTenant: false
      })
    ).toEqual({
      allowed: false,
      needsApproval: false,
      reason: "denied_by_policy"
    });
  });

  it("requires approval when policy outcome is escalate", () => {
    expect(
      authorizeAction({
        riskLevel: "medium",
        outcome: "escalate",
        policyAvailable: true,
        externalTenant: false
      })
    ).toEqual({
      allowed: false,
      needsApproval: true,
      reason: "approval_required"
    });
  });

  it("allows when policy outcome is allow", () => {
    expect(
      authorizeAction({
        riskLevel: "low",
        outcome: "allow",
        policyAvailable: true,
        externalTenant: true
      })
    ).toEqual({
      allowed: true,
      needsApproval: false,
      reason: "allowed"
    });
  });
});
