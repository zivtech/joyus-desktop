import { describe, expect, it } from "vitest";
import {
  createEventBuffer,
  bufferEvent,
  collectCliEvent,
  flushBuffer,
} from "../src/cliCollector";
import type { CliEventInput } from "../src/cliCollector";
import type { TelemetryEvent } from "../src/schema";
import { SCHEMA_VERSION } from "../src/schema";
import type { FetchLike, TelemetryClientConfig } from "../src/telemetryClient";

const FIXED_ID = "test-id";
const FIXED_TIMESTAMP = "2026-03-11T00:00:00Z";
const generateId = (): string => FIXED_ID;
const now = (): string => FIXED_TIMESTAMP;

const config: TelemetryClientConfig = {
  endpoint: "https://example.com/api/telemetry/events",
  apiKey: "test-key",
};

function makeEvent(name: string): TelemetryEvent {
  return {
    event_id: `evt-${name}`,
    timestamp: FIXED_TIMESTAMP,
    user_id: "user-1",
    org_id: "org-1",
    channel: "cli",
    event_type: "skill_invocation",
    name,
    outcome: "success",
    schema_version: SCHEMA_VERSION,
  };
}

describe("createEventBuffer", () => {
  it("creates empty buffer with given max size", () => {
    const buffer = createEventBuffer(10);
    expect(buffer.events).toEqual([]);
    expect(buffer.maxSize).toBe(10);
  });
});

describe("bufferEvent", () => {
  it("adds event to buffer", () => {
    const buffer = createEventBuffer(5);
    const event = makeEvent("skill-a");
    const result = bufferEvent(buffer, event);

    expect(result).toBe(true);
    expect(buffer.events).toHaveLength(1);
    expect(buffer.events[0]).toBe(event);
  });

  it("drops oldest event when buffer is full", () => {
    const buffer = createEventBuffer(2);
    const event1 = makeEvent("skill-1");
    const event2 = makeEvent("skill-2");
    const event3 = makeEvent("skill-3");

    bufferEvent(buffer, event1);
    bufferEvent(buffer, event2);
    const result = bufferEvent(buffer, event3);

    expect(result).toBe(true);
    expect(buffer.events).toHaveLength(2);
    expect(buffer.events[0]).toBe(event2);
    expect(buffer.events[1]).toBe(event3);
  });
});

describe("collectCliEvent", () => {
  const baseInput: CliEventInput = {
    user_id: "user-1",
    org_id: "org-1",
    name: "my-skill",
    event_type: "skill_invocation",
    outcome: "success",
  };

  it("creates event with cli channel", () => {
    const event = collectCliEvent(
      baseInput,
      { telemetryDisabled: false },
      generateId,
      now,
    );

    expect(event).not.toBeNull();
    expect(event!.channel).toBe("cli");
    expect(event!.event_id).toBe(FIXED_ID);
    expect(event!.timestamp).toBe(FIXED_TIMESTAMP);
    expect(event!.user_id).toBe("user-1");
    expect(event!.name).toBe("my-skill");
    expect(event!.schema_version).toBe(SCHEMA_VERSION);
  });

  it("includes optional fields when provided", () => {
    const input: CliEventInput = {
      ...baseInput,
      version: "1.0.0",
      duration_ms: 200,
      metadata: { env: "test" },
    };

    const event = collectCliEvent(
      input,
      { telemetryDisabled: false },
      generateId,
      now,
    );

    expect(event!.version).toBe("1.0.0");
    expect(event!.duration_ms).toBe(200);
    expect(event!.metadata).toEqual({ env: "test" });
  });

  it("returns null when opted out", () => {
    const event = collectCliEvent(
      baseInput,
      { telemetryDisabled: true },
      generateId,
      now,
    );

    expect(event).toBeNull();
  });
});

describe("flushBuffer", () => {
  it("sends all events and clears buffer on success", async () => {
    const buffer = createEventBuffer(10);
    bufferEvent(buffer, makeEvent("a"));
    bufferEvent(buffer, makeEvent("b"));

    const fetchLike: FetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () => "",
    });

    const result = await flushBuffer(buffer, fetchLike, config);

    expect(result.flushed).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.remaining).toBe(0);
    expect(buffer.events).toHaveLength(0);
  });

  it("keeps events on failure", async () => {
    const buffer = createEventBuffer(10);
    bufferEvent(buffer, makeEvent("a"));

    const fetchLike: FetchLike = async () => ({
      ok: false,
      status: 500,
      text: async () => "Server Error",
    });

    const result = await flushBuffer(buffer, fetchLike, config);

    expect(result.flushed).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.remaining).toBe(1);
    expect(buffer.events).toHaveLength(1);
  });

  it("returns zero counts for empty buffer", async () => {
    const buffer = createEventBuffer(10);
    const fetchLike: FetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () => "",
    });

    const result = await flushBuffer(buffer, fetchLike, config);

    expect(result.flushed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.remaining).toBe(0);
  });
});
