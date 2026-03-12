import { describe, expect, it } from "vitest";
import {
  SCHEMA_VERSION,
  createTelemetryEvent,
  validateTelemetryEvent,
} from "../src/schema";
import type { TelemetryEventInput } from "../src/schema";

const FIXED_ID = "test-uuid-1234";
const FIXED_TIMESTAMP = "2026-03-11T00:00:00Z";
const generateId = (): string => FIXED_ID;
const now = (): string => FIXED_TIMESTAMP;

const baseInput: TelemetryEventInput = {
  user_id: "user-1",
  org_id: "org-1",
  channel: "cli",
  event_type: "skill_invocation",
  name: "my-skill",
  outcome: "success",
};

describe("createTelemetryEvent", () => {
  it("creates event with required fields only", () => {
    const event = createTelemetryEvent(baseInput, generateId, now);

    expect(event.event_id).toBe(FIXED_ID);
    expect(event.timestamp).toBe(FIXED_TIMESTAMP);
    expect(event.user_id).toBe("user-1");
    expect(event.org_id).toBe("org-1");
    expect(event.channel).toBe("cli");
    expect(event.event_type).toBe("skill_invocation");
    expect(event.name).toBe("my-skill");
    expect(event.outcome).toBe("success");
    expect(event.schema_version).toBe(SCHEMA_VERSION);
    expect(event.version).toBeUndefined();
    expect(event.duration_ms).toBeUndefined();
    expect(event.metadata).toBeUndefined();
  });

  it("creates event with all optional fields", () => {
    const input: TelemetryEventInput = {
      ...baseInput,
      version: "1.2.3",
      duration_ms: 150,
      metadata: { key: "value" },
    };

    const event = createTelemetryEvent(input, generateId, now);

    expect(event.version).toBe("1.2.3");
    expect(event.duration_ms).toBe(150);
    expect(event.metadata).toEqual({ key: "value" });
  });
});

describe("validateTelemetryEvent", () => {
  const validEvent = {
    event_id: FIXED_ID,
    timestamp: FIXED_TIMESTAMP,
    user_id: "user-1",
    org_id: "org-1",
    channel: "cli",
    event_type: "skill_invocation",
    name: "my-skill",
    outcome: "success",
    schema_version: "v1",
  };

  it("accepts a valid event", () => {
    const result = validateTelemetryEvent(validEvent);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects non-object input", () => {
    const result = validateTelemetryEvent("not an object");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Event must be an object");
  });

  it("rejects null input", () => {
    const result = validateTelemetryEvent(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Event must be an object");
  });

  it("rejects array input", () => {
    const result = validateTelemetryEvent([]);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Event must be an object");
  });

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
    it(`reports missing ${field}`, () => {
      const event = { ...validEvent, [field]: undefined };
      const result = validateTelemetryEvent(event);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(`Missing required field: ${field}`);
    });
  }

  it("reports non-string required field", () => {
    const event = { ...validEvent, event_id: 123 };
    const result = validateTelemetryEvent(event);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Field event_id must be a string");
  });

  it("reports invalid channel", () => {
    const event = { ...validEvent, channel: "invalid" };
    const result = validateTelemetryEvent(event);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Invalid channel: invalid");
  });

  it("reports invalid event_type", () => {
    const event = { ...validEvent, event_type: "invalid" };
    const result = validateTelemetryEvent(event);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Invalid event_type: invalid");
  });

  it("reports invalid outcome", () => {
    const event = { ...validEvent, outcome: "invalid" };
    const result = validateTelemetryEvent(event);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Invalid outcome: invalid");
  });

  it("reports invalid timestamp format", () => {
    const event = { ...validEvent, timestamp: "not-a-date" };
    const result = validateTelemetryEvent(event);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Invalid timestamp format: not-a-date");
  });

  it("accepts timestamp with offset", () => {
    const event = { ...validEvent, timestamp: "2026-03-11T00:00:00+05:00" };
    const result = validateTelemetryEvent(event);
    expect(result.valid).toBe(true);
  });

  it("accepts timestamp with milliseconds", () => {
    const event = { ...validEvent, timestamp: "2026-03-11T00:00:00.123Z" };
    const result = validateTelemetryEvent(event);
    expect(result.valid).toBe(true);
  });

  it("reports multiple errors at once", () => {
    const event = { ...validEvent, channel: "bad", outcome: "bad" };
    const result = validateTelemetryEvent(event);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("reports null required field as missing", () => {
    const event = { ...validEvent, name: null };
    const result = validateTelemetryEvent(event);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: name");
  });
});
