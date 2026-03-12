import type { EventType, Outcome, TelemetryEvent } from "./schema";
import { createTelemetryEvent } from "./schema";
import type { OptOutConfig } from "./optOut";
import { isOptedOut } from "./optOut";

export interface CoworkEventInput {
  user_id: string;
  org_id: string;
  name: string;
  event_type: EventType;
  outcome: Outcome;
  version?: string;
  duration_ms?: number;
  metadata?: Record<string, string>;
}

export function collectCoworkEvent(
  input: CoworkEventInput,
  optOutConfig: OptOutConfig,
  generateId: () => string,
  now: () => string,
): TelemetryEvent | null {
  if (isOptedOut(optOutConfig)) {
    return null;
  }

  return createTelemetryEvent(
    {
      user_id: input.user_id,
      org_id: input.org_id,
      channel: "cowork",
      event_type: input.event_type,
      name: input.name,
      outcome: input.outcome,
      ...(input.version !== undefined ? { version: input.version } : {}),
      ...(input.duration_ms !== undefined
        ? { duration_ms: input.duration_ms }
        : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    },
    generateId,
    now,
  );
}
