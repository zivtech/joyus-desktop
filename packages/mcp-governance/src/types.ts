export type GovernanceMode = "off" | "audit" | "enforce";
export type GovernanceDecision = "allow" | "deny" | "audit";
export type ToolOutcome = "success" | "failure" | "timeout" | "blocked";

export interface PolicyCheckFn {
  (toolName: string, context: GovernanceContext): Promise<GovernanceDecision>;
}

export interface GovernanceContext {
  orgId: string;
  userId: string;
  serverName: string;
  toolName: string;
}

export interface GovernanceConfig {
  mode: GovernanceMode;
  updatedAt: string;
}

export interface GovernanceResult {
  proceed: boolean;
  decision: GovernanceDecision;
  audited: boolean;
  error?: string;
}

export interface TelemetryEmitFn {
  (event: DesktopTelemetryEvent): Promise<void>;
}

export interface DesktopTelemetryEvent {
  eventId: string;
  timestamp: string;
  userId: string;
  orgId: string;
  channel: "desktop";
  eventType: "mcp_tool_call";
  serverName: string;
  toolName: string;
  outcome: ToolOutcome;
  durationMs: number;
  metadata: Record<string, string>;
}

export interface GovernanceDeps {
  checkPolicy: PolicyCheckFn;
  emitTelemetry: TelemetryEmitFn;
  readConfig: () => Promise<GovernanceConfig>;
  log: (level: "info" | "warn" | "error", message: string) => void;
  generateId: () => string;
  now: () => string;
}
