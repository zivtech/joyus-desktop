import { describe, expect, it } from "vitest";
import { collectCoworkEvent } from "../src/coworkCollector";
import type { CoworkEventInput } from "../src/coworkCollector";
import { SCHEMA_VERSION } from "../src/schema";

const FIXED_ID = "cowork-uuid";
const FIXED_TIMESTAMP = "2026-03-11T12:00:00Z";
const generateId = (): string => FIXED_ID;
const now = (): string => FIXED_TIMESTAMP;

const baseInput: CoworkEventInput = {
  user_id: "user-1",
  org_id: "org-1",
  name: "cowork-skill",
  event_type: "skill_invocation",
  outcome: "success",
};

describe("collectCoworkEvent", () => {
  it("creates event with cowork channel", () => {
    const event = collectCoworkEvent(
      baseInput,
      { telemetryDisabled: false },
      generateId,
      now,
    );

    expect(event).not.toBeNull();
    expect(event!.channel).toBe("cowork");
    expect(event!.event_id).toBe(FIXED_ID);
    expect(event!.timestamp).toBe(FIXED_TIMESTAMP);
    expect(event!.user_id).toBe("user-1");
    expect(event!.org_id).toBe("org-1");
    expect(event!.name).toBe("cowork-skill");
    expect(event!.event_type).toBe("skill_invocation");
    expect(event!.outcome).toBe("success");
    expect(event!.schema_version).toBe(SCHEMA_VERSION);
    expect(event!.version).toBeUndefined();
    expect(event!.duration_ms).toBeUndefined();
    expect(event!.metadata).toBeUndefined();
  });

  it("includes all optional fields when provided", () => {
    const input: CoworkEventInput = {
      ...baseInput,
      version: "2.0.0",
      duration_ms: 500,
      metadata: { source: "cowork-ui" },
    };

    const event = collectCoworkEvent(
      input,
      { telemetryDisabled: false },
      generateId,
      now,
    );

    expect(event!.version).toBe("2.0.0");
    expect(event!.duration_ms).toBe(500);
    expect(event!.metadata).toEqual({ source: "cowork-ui" });
  });

  it("returns null when opted out", () => {
    const event = collectCoworkEvent(
      baseInput,
      { telemetryDisabled: true },
      generateId,
      now,
    );

    expect(event).toBeNull();
  });
});
