import { describe, expect, it, vi } from "vitest";
import { createDesktopEvent, emitToolCallEvent, isOptedOut } from "../src/telemetryEmitter";
import type { CreateEventParams } from "../src/telemetryEmitter";
import type { GovernanceDeps } from "../src/types";

function createParams(overrides?: Partial<CreateEventParams>): CreateEventParams {
  return {
    userId: "user-1",
    orgId: "org-1",
    serverName: "test-server",
    toolName: "test-tool",
    outcome: "success",
    durationMs: 150,
    ...overrides
  };
}

function createDeps(
  overrides?: Partial<Pick<GovernanceDeps, "generateId" | "now" | "emitTelemetry" | "log">>
): Pick<GovernanceDeps, "generateId" | "now" | "emitTelemetry" | "log"> {
  return {
    generateId: vi.fn().mockReturnValue("evt-123"),
    now: vi.fn().mockReturnValue("2026-01-01T00:00:00Z"),
    emitTelemetry: vi.fn().mockResolvedValue(undefined),
    log: vi.fn(),
    ...overrides
  };
}

describe("createDesktopEvent", () => {
  it("creates event with channel desktop and eventType mcp_tool_call", () => {
    const params = createParams();
    const deps = createDeps();

    const event = createDesktopEvent(params, deps);

    expect(event).toEqual({
      eventId: "evt-123",
      timestamp: "2026-01-01T00:00:00Z",
      userId: "user-1",
      orgId: "org-1",
      channel: "desktop",
      eventType: "mcp_tool_call",
      serverName: "test-server",
      toolName: "test-tool",
      outcome: "success",
      durationMs: 150,
      metadata: {}
    });
  });

  it("includes metadata when provided", () => {
    const params = createParams({ metadata: { key: "value" } });
    const deps = createDeps();

    const event = createDesktopEvent(params, deps);

    expect(event.metadata).toEqual({ key: "value" });
  });

  it("defaults metadata to empty object when not provided", () => {
    const params = createParams();
    delete (params as Partial<CreateEventParams>).metadata;
    const deps = createDeps();

    const event = createDesktopEvent(params, deps);

    expect(event.metadata).toEqual({});
  });

  it("uses generateId and now from deps", () => {
    const deps = createDeps({
      generateId: vi.fn().mockReturnValue("custom-id"),
      now: vi.fn().mockReturnValue("2026-06-15T12:00:00Z")
    });

    const event = createDesktopEvent(createParams(), deps);

    expect(event.eventId).toBe("custom-id");
    expect(event.timestamp).toBe("2026-06-15T12:00:00Z");
  });
});

describe("emitToolCallEvent", () => {
  it("creates and emits a telemetry event", async () => {
    const deps = createDeps();
    const params = createParams();

    await emitToolCallEvent(params, deps);

    expect(deps.emitTelemetry).toHaveBeenCalledWith({
      eventId: "evt-123",
      timestamp: "2026-01-01T00:00:00Z",
      userId: "user-1",
      orgId: "org-1",
      channel: "desktop",
      eventType: "mcp_tool_call",
      serverName: "test-server",
      toolName: "test-tool",
      outcome: "success",
      durationMs: 150,
      metadata: {}
    });
  });

  it("catches and logs errors from emitTelemetry", async () => {
    const deps = createDeps({
      emitTelemetry: vi.fn().mockRejectedValue(new Error("send failed"))
    });

    await emitToolCallEvent(createParams(), deps);

    expect(deps.log).toHaveBeenCalledWith(
      "error",
      "Failed to emit telemetry for test-tool: send failed"
    );
  });

  it("handles non-Error thrown values from emitTelemetry", async () => {
    const deps = createDeps({
      emitTelemetry: vi.fn().mockRejectedValue("raw error")
    });

    await emitToolCallEvent(createParams(), deps);

    expect(deps.log).toHaveBeenCalledWith(
      "error",
      "Failed to emit telemetry for test-tool: raw error"
    );
  });
});

describe("isOptedOut", () => {
  it("returns true when SKILL_TELEMETRY_DISABLED is 1", () => {
    expect(isOptedOut({ SKILL_TELEMETRY_DISABLED: "1" })).toBe(true);
  });

  it("returns true when SKILL_TELEMETRY_DISABLED is true", () => {
    expect(isOptedOut({ SKILL_TELEMETRY_DISABLED: "true" })).toBe(true);
  });

  it("returns false when SKILL_TELEMETRY_DISABLED is 0", () => {
    expect(isOptedOut({ SKILL_TELEMETRY_DISABLED: "0" })).toBe(false);
  });

  it("returns false when SKILL_TELEMETRY_DISABLED is undefined", () => {
    expect(isOptedOut({})).toBe(false);
  });

  it("returns false when SKILL_TELEMETRY_DISABLED is empty string", () => {
    expect(isOptedOut({ SKILL_TELEMETRY_DISABLED: "" })).toBe(false);
  });

  it("returns false when SKILL_TELEMETRY_DISABLED is false string", () => {
    expect(isOptedOut({ SKILL_TELEMETRY_DISABLED: "false" })).toBe(false);
  });
});
