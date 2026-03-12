import type { EventType, Outcome, TelemetryEvent } from "./schema";
import { createTelemetryEvent } from "./schema";
import type { OptOutConfig } from "./optOut";
import { isOptedOut } from "./optOut";
import type { FetchLike, TelemetryClientConfig } from "./telemetryClient";
import { sendTelemetryBatch } from "./telemetryClient";

export interface EventBuffer {
  events: TelemetryEvent[];
  maxSize: number;
}

export interface FlushResult {
  flushed: number;
  failed: number;
  remaining: number;
}

export interface CliEventInput {
  user_id: string;
  org_id: string;
  name: string;
  event_type: EventType;
  outcome: Outcome;
  version?: string;
  duration_ms?: number;
  metadata?: Record<string, string>;
}

export function createEventBuffer(maxSize: number): EventBuffer {
  return { events: [], maxSize };
}

export function bufferEvent(
  buffer: EventBuffer,
  event: TelemetryEvent,
): boolean {
  if (buffer.events.length >= buffer.maxSize) {
    buffer.events.shift();
  }
  buffer.events.push(event);
  return true;
}

export function collectCliEvent(
  input: CliEventInput,
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
      channel: "cli",
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

export async function flushBuffer(
  buffer: EventBuffer,
  fetchLike: FetchLike,
  config: TelemetryClientConfig,
): Promise<FlushResult> {
  if (buffer.events.length === 0) {
    return { flushed: 0, failed: 0, remaining: 0 };
  }

  const count = buffer.events.length;
  const result = await sendTelemetryBatch(fetchLike, config, buffer.events);

  if (result.accepted) {
    buffer.events.length = 0;
    return { flushed: count, failed: 0, remaining: 0 };
  }

  return { flushed: 0, failed: count, remaining: count };
}
