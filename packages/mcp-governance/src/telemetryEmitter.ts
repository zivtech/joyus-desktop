import type { DesktopTelemetryEvent, GovernanceDeps, ToolOutcome } from "./types";

export interface CreateEventParams {
  userId: string;
  orgId: string;
  serverName: string;
  toolName: string;
  outcome: ToolOutcome;
  durationMs: number;
  metadata?: Record<string, string>;
}

export function createDesktopEvent(
  params: CreateEventParams,
  deps: Pick<GovernanceDeps, "generateId" | "now">
): DesktopTelemetryEvent {
  return {
    eventId: deps.generateId(),
    timestamp: deps.now(),
    userId: params.userId,
    orgId: params.orgId,
    channel: "desktop",
    eventType: "mcp_tool_call",
    serverName: params.serverName,
    toolName: params.toolName,
    outcome: params.outcome,
    durationMs: params.durationMs,
    metadata: params.metadata ?? {}
  };
}

export async function emitToolCallEvent(
  params: CreateEventParams,
  deps: Pick<GovernanceDeps, "generateId" | "now" | "emitTelemetry" | "log">
): Promise<void> {
  const event = createDesktopEvent(params, deps);
  try {
    await deps.emitTelemetry(event);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    deps.log("error", `Failed to emit telemetry for ${params.toolName}: ${message}`);
  }
}

export function isOptedOut(env: Record<string, string | undefined>): boolean {
  const value = env["SKILL_TELEMETRY_DISABLED"];
  return value === "1" || value === "true";
}
