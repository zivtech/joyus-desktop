export const SCHEMA_VERSION = "v1" as const;
export type Channel = "cowork" | "cli" | "desktop";
export type EventType = "skill_invocation" | "mcp_tool_call";
export type Outcome = "success" | "failure" | "timeout";

export interface TelemetryEvent {
  event_id: string;
  timestamp: string;
  user_id: string;
  org_id: string;
  channel: Channel;
  event_type: EventType;
  name: string;
  outcome: Outcome;
  schema_version: typeof SCHEMA_VERSION;
  version?: string;
  duration_ms?: number;
  metadata?: Record<string, string>;
}

export interface TelemetryEventInput {
  user_id: string;
  org_id: string;
  channel: Channel;
  event_type: EventType;
  name: string;
  outcome: Outcome;
  version?: string;
  duration_ms?: number;
  metadata?: Record<string, string>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const VALID_CHANNELS: readonly string[] = ["cowork", "cli", "desktop"];
const VALID_EVENT_TYPES: readonly string[] = ["skill_invocation", "mcp_tool_call"];
const VALID_OUTCOMES: readonly string[] = ["success", "failure", "timeout"];
const ISO_8601_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

export function createTelemetryEvent(
  input: TelemetryEventInput,
  generateId: () => string,
  now: () => string,
): TelemetryEvent {
  const base: TelemetryEvent = {
    event_id: generateId(),
    timestamp: now(),
    user_id: input.user_id,
    org_id: input.org_id,
    channel: input.channel,
    event_type: input.event_type,
    name: input.name,
    outcome: input.outcome,
    schema_version: SCHEMA_VERSION,
  };

  if (input.version !== undefined) {
    base.version = input.version;
  }
  if (input.duration_ms !== undefined) {
    base.duration_ms = input.duration_ms;
  }
  if (input.metadata !== undefined) {
    base.metadata = input.metadata;
  }

  return base;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateTelemetryEvent(event: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isRecord(event)) {
    return { valid: false, errors: ["Event must be an object"] };
  }

  const requiredFields = [
    "event_id",
    "timestamp",
    "user_id",
    "org_id",
    "channel",
    "event_type",
    "name",
    "outcome",
    "schema_version",
  ] as const;

  for (const field of requiredFields) {
    if (event[field] === undefined || event[field] === null) {
      errors.push(`Missing required field: ${field}`);
    } else if (typeof event[field] !== "string") {
      errors.push(`Field ${field} must be a string`);
    }
  }

  if (typeof event["channel"] === "string" && !VALID_CHANNELS.includes(event["channel"])) {
    errors.push(`Invalid channel: ${event["channel"]}`);
  }

  if (
    typeof event["event_type"] === "string" &&
    !VALID_EVENT_TYPES.includes(event["event_type"])
  ) {
    errors.push(`Invalid event_type: ${event["event_type"]}`);
  }

  if (typeof event["outcome"] === "string" && !VALID_OUTCOMES.includes(event["outcome"])) {
    errors.push(`Invalid outcome: ${event["outcome"]}`);
  }

  if (typeof event["timestamp"] === "string" && !ISO_8601_REGEX.test(event["timestamp"])) {
    errors.push(`Invalid timestamp format: ${event["timestamp"]}`);
  }

  return { valid: errors.length === 0, errors };
}
