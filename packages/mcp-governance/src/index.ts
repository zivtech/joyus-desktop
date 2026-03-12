export type {
  GovernanceMode,
  GovernanceDecision,
  ToolOutcome,
  PolicyCheckFn,
  GovernanceContext,
  GovernanceConfig,
  GovernanceResult,
  TelemetryEmitFn,
  DesktopTelemetryEvent,
  GovernanceDeps
} from "./types";

export { enforceGovernance } from "./governanceEnforcer";

export {
  createDesktopEvent,
  emitToolCallEvent,
  isOptedOut
} from "./telemetryEmitter";
export type { CreateEventParams } from "./telemetryEmitter";

export {
  parseGovernanceConfig,
  readGovernanceConfig,
  createConfigPoller
} from "./configReader";
export type { ConfigPoller } from "./configReader";

export { createMcpMiddleware } from "./mcpMiddleware";
export type { ToolCallFn, MiddlewareResult, McpMiddleware } from "./mcpMiddleware";
