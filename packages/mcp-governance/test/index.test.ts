import { describe, expect, it } from "vitest";
import {
  enforceGovernance,
  createDesktopEvent,
  emitToolCallEvent,
  isOptedOut,
  parseGovernanceConfig,
  readGovernanceConfig,
  createConfigPoller,
  createMcpMiddleware,
} from "../src/index";

describe("index re-exports", () => {
  it("exports governanceEnforcer functions", () => {
    expect(enforceGovernance).toBeTypeOf("function");
  });

  it("exports telemetryEmitter functions", () => {
    expect(createDesktopEvent).toBeTypeOf("function");
    expect(emitToolCallEvent).toBeTypeOf("function");
    expect(isOptedOut).toBeTypeOf("function");
  });

  it("exports configReader functions", () => {
    expect(parseGovernanceConfig).toBeTypeOf("function");
    expect(readGovernanceConfig).toBeTypeOf("function");
    expect(createConfigPoller).toBeTypeOf("function");
  });

  it("exports mcpMiddleware functions", () => {
    expect(createMcpMiddleware).toBeTypeOf("function");
  });
});
