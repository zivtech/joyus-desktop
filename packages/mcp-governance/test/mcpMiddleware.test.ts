import { describe, expect, it, vi, beforeEach } from "vitest";
import { createMcpMiddleware } from "../src/mcpMiddleware";
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

describe("createMcpMiddleware", () => {
  let context: GovernanceContext;

  beforeEach(() => {
    context = createContext();
  });

  it("executes tool and emits success telemetry when governance is off", async () => {
    const deps = createDeps();
    const middleware = createMcpMiddleware(deps);
    const executeTool = vi.fn().mockResolvedValue({ data: "result" });

    const result = await middleware(context, executeTool);

    expect(result.governance.proceed).toBe(true);
    expect(result.toolResult).toEqual({ data: "result" });
    expect(result.error).toBeUndefined();
    expect(executeTool).toHaveBeenCalled();
    expect(deps.emitTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "desktop",
        eventType: "mcp_tool_call",
        outcome: "success",
        toolName: "test-tool"
      })
    );
  });

  it("blocks tool and emits blocked telemetry when governance denies", async () => {
    const deps = createDeps({
      readConfig: vi.fn().mockResolvedValue({ mode: "enforce", updatedAt: "" }),
      checkPolicy: vi.fn().mockResolvedValue("deny")
    });
    const middleware = createMcpMiddleware(deps);
    const executeTool = vi.fn();

    const result = await middleware(context, executeTool);

    expect(result.governance.proceed).toBe(false);
    expect(result.governance.decision).toBe("deny");
    expect(result.error).toBe("Tool test-tool blocked by governance policy");
    expect(result.toolResult).toBeUndefined();
    expect(executeTool).not.toHaveBeenCalled();
    expect(deps.emitTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "blocked",
        metadata: { decision: "deny" }
      })
    );
  });

  it("emits failure telemetry when tool throws", async () => {
    const deps = createDeps();
    const middleware = createMcpMiddleware(deps);
    const executeTool = vi.fn().mockRejectedValue(new Error("tool crash"));

    const result = await middleware(context, executeTool);

    expect(result.governance.proceed).toBe(true);
    expect(result.error).toBe("tool crash");
    expect(result.toolResult).toBeUndefined();
    expect(deps.emitTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "failure",
        metadata: { error: "tool crash" }
      })
    );
  });

  it("handles non-Error thrown values from tool execution", async () => {
    const deps = createDeps();
    const middleware = createMcpMiddleware(deps);
    const executeTool = vi.fn().mockRejectedValue("string error");

    const result = await middleware(context, executeTool);

    expect(result.error).toBe("string error");
    expect(deps.emitTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "failure",
        metadata: { error: "string error" }
      })
    );
  });

  it("executes tool in audit mode even when policy returns deny", async () => {
    const deps = createDeps({
      readConfig: vi.fn().mockResolvedValue({ mode: "audit", updatedAt: "" }),
      checkPolicy: vi.fn().mockResolvedValue("deny")
    });
    const middleware = createMcpMiddleware(deps);
    const executeTool = vi.fn().mockResolvedValue("ok");

    const result = await middleware(context, executeTool);

    expect(result.governance.proceed).toBe(true);
    expect(result.governance.decision).toBe("deny");
    expect(result.governance.audited).toBe(true);
    expect(executeTool).toHaveBeenCalled();
    expect(result.toolResult).toBe("ok");
  });

  it("executes tool in enforce mode when policy returns allow", async () => {
    const deps = createDeps({
      readConfig: vi.fn().mockResolvedValue({ mode: "enforce", updatedAt: "" }),
      checkPolicy: vi.fn().mockResolvedValue("allow")
    });
    const middleware = createMcpMiddleware(deps);
    const executeTool = vi.fn().mockResolvedValue({ result: 42 });

    const result = await middleware(context, executeTool);

    expect(result.governance.proceed).toBe(true);
    expect(result.governance.decision).toBe("allow");
    expect(result.toolResult).toEqual({ result: 42 });
    expect(executeTool).toHaveBeenCalled();
  });

  it("blocks when enforce mode policy check throws (fail-closed)", async () => {
    const deps = createDeps({
      readConfig: vi.fn().mockResolvedValue({ mode: "enforce", updatedAt: "" }),
      checkPolicy: vi.fn().mockRejectedValue(new Error("policy service down"))
    });
    const middleware = createMcpMiddleware(deps);
    const executeTool = vi.fn();

    const result = await middleware(context, executeTool);

    expect(result.governance.proceed).toBe(false);
    expect(result.governance.decision).toBe("deny");
    expect(result.error).toBe("Tool test-tool blocked by governance policy");
    expect(executeTool).not.toHaveBeenCalled();
    expect(deps.emitTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "blocked" })
    );
  });

  it("includes durationMs in telemetry for successful tool calls", async () => {
    const deps = createDeps();
    const middleware = createMcpMiddleware(deps);
    const executeTool = vi.fn().mockResolvedValue("done");

    await middleware(context, executeTool);

    expect(deps.emitTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        durationMs: expect.any(Number) as number
      })
    );
  });

  it("includes durationMs in telemetry for failed tool calls", async () => {
    const deps = createDeps();
    const middleware = createMcpMiddleware(deps);
    const executeTool = vi.fn().mockRejectedValue(new Error("fail"));

    await middleware(context, executeTool);

    expect(deps.emitTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        durationMs: expect.any(Number) as number,
        outcome: "failure"
      })
    );
  });

  it("sets durationMs to 0 for blocked tool calls", async () => {
    const deps = createDeps({
      readConfig: vi.fn().mockResolvedValue({ mode: "enforce", updatedAt: "" }),
      checkPolicy: vi.fn().mockResolvedValue("deny")
    });
    const middleware = createMcpMiddleware(deps);
    const executeTool = vi.fn();

    await middleware(context, executeTool);

    expect(deps.emitTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ durationMs: 0, outcome: "blocked" })
    );
  });
});
