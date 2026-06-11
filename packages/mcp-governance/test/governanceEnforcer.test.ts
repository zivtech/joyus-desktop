import { describe, expect, it, vi, beforeEach } from "vitest";
import { enforceGovernance } from "../src/governanceEnforcer";
import type { GovernanceContext, GovernanceDeps } from "../src/types";

function createContext(overrides?: Partial<GovernanceContext>): GovernanceContext {
  return {
    orgId: "org-1",
    userId: "user-1",
    serverName: "test-server",
    toolName: "test-tool",
    ...overrides
  };
}

function createDeps(overrides?: Partial<GovernanceDeps>): GovernanceDeps {
  return {
    checkPolicy: vi.fn().mockResolvedValue("allow"),
    emitTelemetry: vi.fn().mockResolvedValue(undefined),
    readConfig: vi.fn().mockResolvedValue({ mode: "off", updatedAt: "" }),
    log: vi.fn(),
    generateId: vi.fn().mockReturnValue("evt-1"),
    now: vi.fn().mockReturnValue("2026-01-01T00:00:00Z"),
    ...overrides
  };
}

describe("enforceGovernance", () => {
  let context: GovernanceContext;

  beforeEach(() => {
    context = createContext();
  });

  describe("mode off", () => {
    it("returns allow without calling checkPolicy", async () => {
      const deps = createDeps({
        readConfig: vi.fn().mockResolvedValue({ mode: "off", updatedAt: "" })
      });

      const result = await enforceGovernance(context, deps);

      expect(result).toEqual({ proceed: true, decision: "allow", audited: false });
      expect(deps.checkPolicy).not.toHaveBeenCalled();
    });
  });

  describe("mode audit", () => {
    it("proceeds even when policy returns deny", async () => {
      const deps = createDeps({
        readConfig: vi.fn().mockResolvedValue({ mode: "audit", updatedAt: "" }),
        checkPolicy: vi.fn().mockResolvedValue("deny")
      });

      const result = await enforceGovernance(context, deps);

      expect(result).toEqual({ proceed: true, decision: "deny", audited: true });
      expect(deps.checkPolicy).toHaveBeenCalledWith("test-tool", context);
      expect(deps.log).toHaveBeenCalledWith("info", "Audit: tool=test-tool decision=deny");
    });

    it("proceeds when policy returns allow", async () => {
      const deps = createDeps({
        readConfig: vi.fn().mockResolvedValue({ mode: "audit", updatedAt: "" }),
        checkPolicy: vi.fn().mockResolvedValue("allow")
      });

      const result = await enforceGovernance(context, deps);

      expect(result).toEqual({ proceed: true, decision: "allow", audited: true });
    });

    it("proceeds when policy returns audit decision", async () => {
      const deps = createDeps({
        readConfig: vi.fn().mockResolvedValue({ mode: "audit", updatedAt: "" }),
        checkPolicy: vi.fn().mockResolvedValue("audit")
      });

      const result = await enforceGovernance(context, deps);

      expect(result).toEqual({ proceed: true, decision: "audit", audited: true });
      expect(deps.log).toHaveBeenCalledWith("info", "Audit: tool=test-tool decision=audit");
    });

    it("proceeds with logged error when checkPolicy throws", async () => {
      const deps = createDeps({
        readConfig: vi.fn().mockResolvedValue({ mode: "audit", updatedAt: "" }),
        checkPolicy: vi.fn().mockRejectedValue(new Error("network failure"))
      });

      const result = await enforceGovernance(context, deps);

      expect(result).toEqual({
        proceed: true,
        decision: "allow",
        audited: true,
        error: "network failure"
      });
      expect(deps.log).toHaveBeenCalledWith(
        "error",
        "Policy check failed in audit mode for test-tool: network failure"
      );
    });

    it("handles non-Error thrown values in audit mode", async () => {
      const deps = createDeps({
        readConfig: vi.fn().mockResolvedValue({ mode: "audit", updatedAt: "" }),
        checkPolicy: vi.fn().mockRejectedValue("string error")
      });

      const result = await enforceGovernance(context, deps);

      expect(result).toEqual({
        proceed: true,
        decision: "allow",
        audited: true,
        error: "string error"
      });
    });
  });

  describe("mode enforce", () => {
    it("blocks when policy returns deny", async () => {
      const deps = createDeps({
        readConfig: vi.fn().mockResolvedValue({ mode: "enforce", updatedAt: "" }),
        checkPolicy: vi.fn().mockResolvedValue("deny")
      });

      const result = await enforceGovernance(context, deps);

      expect(result).toEqual({ proceed: false, decision: "deny", audited: true });
      expect(deps.log).toHaveBeenCalledWith("warn", "Blocked: tool=test-tool decision=deny");
    });

    it("allows when policy returns allow", async () => {
      const deps = createDeps({
        readConfig: vi.fn().mockResolvedValue({ mode: "enforce", updatedAt: "" }),
        checkPolicy: vi.fn().mockResolvedValue("allow")
      });

      const result = await enforceGovernance(context, deps);

      expect(result).toEqual({ proceed: true, decision: "allow", audited: true });
      expect(deps.log).toHaveBeenCalledWith("info", "Allowed: tool=test-tool decision=allow");
    });

    it("allows when policy returns audit decision", async () => {
      const deps = createDeps({
        readConfig: vi.fn().mockResolvedValue({ mode: "enforce", updatedAt: "" }),
        checkPolicy: vi.fn().mockResolvedValue("audit")
      });

      const result = await enforceGovernance(context, deps);

      expect(result).toEqual({ proceed: true, decision: "audit", audited: true });
      expect(deps.log).toHaveBeenCalledWith("info", "Allowed: tool=test-tool decision=audit");
    });

    it("blocks (fail-closed) when checkPolicy throws", async () => {
      const deps = createDeps({
        readConfig: vi.fn().mockResolvedValue({ mode: "enforce", updatedAt: "" }),
        checkPolicy: vi.fn().mockRejectedValue(new Error("timeout"))
      });

      const result = await enforceGovernance(context, deps);

      expect(result).toEqual({
        proceed: false,
        decision: "deny",
        audited: true,
        error: "timeout"
      });
      expect(deps.log).toHaveBeenCalledWith(
        "error",
        "Policy check failed in enforce mode for test-tool: timeout"
      );
    });

    it("handles non-Error thrown values in enforce mode", async () => {
      const deps = createDeps({
        readConfig: vi.fn().mockResolvedValue({ mode: "enforce", updatedAt: "" }),
        checkPolicy: vi.fn().mockRejectedValue(42)
      });

      const result = await enforceGovernance(context, deps);

      expect(result).toEqual({
        proceed: false,
        decision: "deny",
        audited: true,
        error: "42"
      });
    });
  });
});
