import { describe, expect, it, vi } from "vitest";
import { governanceGuard } from "../src/governanceGuard";
import type { GovernanceCheckFn, GovernanceMode } from "../src/governanceGuard";

const base = {
  toolName: "test-tool",
  context: { user: "alice" },
};

function makeCheck(decision: "allow" | "deny" | "audit"): GovernanceCheckFn {
  return vi.fn(async () => decision);
}

function throwingCheck(): GovernanceCheckFn {
  return vi.fn(async () => {
    throw new Error("service down");
  });
}

describe("governanceGuard", () => {
  // ── off mode ──────────────────────────────────────────────────────────
  describe("off mode", () => {
    it("always proceeds without calling check", async () => {
      const check = makeCheck("deny");
      const result = await governanceGuard({ ...base, check, mode: "off" });
      expect(result).toEqual({ proceed: true, audited: false });
      expect(check).not.toHaveBeenCalled();
    });
  });

  // ── audit mode ────────────────────────────────────────────────────────
  describe("audit mode", () => {
    const mode: GovernanceMode = "audit";

    it("proceeds on allow", async () => {
      const result = await governanceGuard({ ...base, check: makeCheck("allow"), mode });
      expect(result).toEqual({ proceed: true, audited: true });
    });

    it("proceeds on audit decision", async () => {
      const result = await governanceGuard({ ...base, check: makeCheck("audit"), mode });
      expect(result).toEqual({ proceed: true, audited: true });
    });

    it("proceeds on deny but calls onAuditDeny", async () => {
      const onAuditDeny = vi.fn();
      const result = await governanceGuard({
        ...base,
        check: makeCheck("deny"),
        mode,
        onAuditDeny,
      });
      expect(result).toEqual({ proceed: true, audited: true });
      expect(onAuditDeny).toHaveBeenCalledWith("test-tool", { user: "alice" });
    });

    it("proceeds on deny without onAuditDeny callback", async () => {
      const result = await governanceGuard({ ...base, check: makeCheck("deny"), mode });
      expect(result).toEqual({ proceed: true, audited: true });
    });

    it("proceeds (fail-open) when check throws", async () => {
      const result = await governanceGuard({ ...base, check: throwingCheck(), mode });
      expect(result).toEqual({ proceed: true, audited: true });
    });
  });

  // ── enforce mode ──────────────────────────────────────────────────────
  describe("enforce mode", () => {
    const mode: GovernanceMode = "enforce";

    it("proceeds on allow", async () => {
      const result = await governanceGuard({ ...base, check: makeCheck("allow"), mode });
      expect(result).toEqual({ proceed: true, audited: false });
    });

    it("proceeds on audit decision and marks audited", async () => {
      const result = await governanceGuard({ ...base, check: makeCheck("audit"), mode });
      expect(result).toEqual({ proceed: true, audited: true });
    });

    it("blocks on deny with error message", async () => {
      const result = await governanceGuard({ ...base, check: makeCheck("deny"), mode });
      expect(result).toEqual({ proceed: false, audited: false, error: "Governance denied" });
    });

    it("blocks when check throws with unavailable message", async () => {
      const result = await governanceGuard({ ...base, check: throwingCheck(), mode });
      expect(result).toEqual({ proceed: false, audited: false, error: "Governance check unavailable" });
    });
  });
});
