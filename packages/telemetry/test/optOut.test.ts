import { describe, expect, it } from "vitest";
import {
  isOptedOut,
  createEnvOptOutReader,
  createConfigOptOutReader,
  resolveOptOut,
} from "../src/optOut";

describe("isOptedOut", () => {
  it("returns true when telemetryDisabled is true", () => {
    expect(isOptedOut({ telemetryDisabled: true })).toBe(true);
  });

  it("returns false when telemetryDisabled is false", () => {
    expect(isOptedOut({ telemetryDisabled: false })).toBe(false);
  });
});

describe("createEnvOptOutReader", () => {
  it("returns opted out for 'true'", () => {
    const reader = createEnvOptOutReader({ SKILL_TELEMETRY_DISABLED: "true" });
    expect(reader.read().telemetryDisabled).toBe(true);
  });

  it("returns opted out for '1'", () => {
    const reader = createEnvOptOutReader({ SKILL_TELEMETRY_DISABLED: "1" });
    expect(reader.read().telemetryDisabled).toBe(true);
  });

  it("returns opted out for 'yes'", () => {
    const reader = createEnvOptOutReader({ SKILL_TELEMETRY_DISABLED: "yes" });
    expect(reader.read().telemetryDisabled).toBe(true);
  });

  it("returns opted out for 'YES' (case-insensitive)", () => {
    const reader = createEnvOptOutReader({ SKILL_TELEMETRY_DISABLED: "YES" });
    expect(reader.read().telemetryDisabled).toBe(true);
  });

  it("returns opted out for 'True' (case-insensitive)", () => {
    const reader = createEnvOptOutReader({ SKILL_TELEMETRY_DISABLED: "True" });
    expect(reader.read().telemetryDisabled).toBe(true);
  });

  it("returns not opted out when env var is undefined", () => {
    const reader = createEnvOptOutReader({});
    expect(reader.read().telemetryDisabled).toBe(false);
  });

  it("returns not opted out for 'false'", () => {
    const reader = createEnvOptOutReader({
      SKILL_TELEMETRY_DISABLED: "false",
    });
    expect(reader.read().telemetryDisabled).toBe(false);
  });

  it("returns not opted out for '0'", () => {
    const reader = createEnvOptOutReader({ SKILL_TELEMETRY_DISABLED: "0" });
    expect(reader.read().telemetryDisabled).toBe(false);
  });

  it("returns not opted out for arbitrary string", () => {
    const reader = createEnvOptOutReader({
      SKILL_TELEMETRY_DISABLED: "anything",
    });
    expect(reader.read().telemetryDisabled).toBe(false);
  });
});

describe("createConfigOptOutReader", () => {
  it("returns opted out when config has telemetry_disabled: true", () => {
    const reader = createConfigOptOutReader(() =>
      JSON.stringify({ telemetry_disabled: true }),
    );
    expect(reader.read().telemetryDisabled).toBe(true);
  });

  it("returns not opted out when config has telemetry_disabled: false", () => {
    const reader = createConfigOptOutReader(() =>
      JSON.stringify({ telemetry_disabled: false }),
    );
    expect(reader.read().telemetryDisabled).toBe(false);
  });

  it("returns not opted out when file returns null", () => {
    const reader = createConfigOptOutReader(() => null);
    expect(reader.read().telemetryDisabled).toBe(false);
  });

  it("returns not opted out when file contains invalid JSON", () => {
    const reader = createConfigOptOutReader(() => "not json{{{");
    expect(reader.read().telemetryDisabled).toBe(false);
  });

  it("returns not opted out when config is missing telemetry_disabled", () => {
    const reader = createConfigOptOutReader(() => JSON.stringify({}));
    expect(reader.read().telemetryDisabled).toBe(false);
  });

  it("returns not opted out when telemetry_disabled is not boolean", () => {
    const reader = createConfigOptOutReader(() =>
      JSON.stringify({ telemetry_disabled: "true" }),
    );
    expect(reader.read().telemetryDisabled).toBe(false);
  });
});

describe("resolveOptOut", () => {
  it("returns not opted out when all readers say false", () => {
    const readers = [
      { read: () => ({ telemetryDisabled: false }) },
      { read: () => ({ telemetryDisabled: false }) },
    ];
    expect(resolveOptOut(readers).telemetryDisabled).toBe(false);
  });

  it("returns opted out when any reader says true", () => {
    const readers = [
      { read: () => ({ telemetryDisabled: false }) },
      { read: () => ({ telemetryDisabled: true }) },
    ];
    expect(resolveOptOut(readers).telemetryDisabled).toBe(true);
  });

  it("returns opted out when first reader says true", () => {
    const readers = [
      { read: () => ({ telemetryDisabled: true }) },
      { read: () => ({ telemetryDisabled: false }) },
    ];
    expect(resolveOptOut(readers).telemetryDisabled).toBe(true);
  });

  it("returns not opted out for empty readers list", () => {
    expect(resolveOptOut([]).telemetryDisabled).toBe(false);
  });
});
