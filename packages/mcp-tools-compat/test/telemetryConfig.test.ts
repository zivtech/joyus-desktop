import { describe, expect, it } from "vitest";
import { isTelemetryEnabled, readTelemetryConfig } from "../src/telemetryConfig";

describe("readTelemetryConfig", () => {
  it("reads all values from env", () => {
    const config = readTelemetryConfig({
      TELEMETRY_ENDPOINT: "https://collect.example.com",
      TELEMETRY_API_KEY: "key-123",
      TELEMETRY_ENABLED: "true",
    });
    expect(config).toEqual({
      endpoint: "https://collect.example.com",
      apiKey: "key-123",
      enabled: true,
    });
  });

  it("defaults endpoint and apiKey to empty strings", () => {
    const config = readTelemetryConfig({});
    expect(config).toEqual({
      endpoint: "",
      apiKey: "",
      enabled: false,
    });
  });

  it("defaults enabled to false when TELEMETRY_ENABLED is undefined", () => {
    const config = readTelemetryConfig({ TELEMETRY_ENDPOINT: "http://x" });
    expect(config.enabled).toBe(false);
  });

  it("treats non-'true' TELEMETRY_ENABLED values as false", () => {
    expect(readTelemetryConfig({ TELEMETRY_ENABLED: "false" }).enabled).toBe(false);
    expect(readTelemetryConfig({ TELEMETRY_ENABLED: "1" }).enabled).toBe(false);
    expect(readTelemetryConfig({ TELEMETRY_ENABLED: "TRUE" }).enabled).toBe(false);
    expect(readTelemetryConfig({ TELEMETRY_ENABLED: "" }).enabled).toBe(false);
  });

  it("handles undefined values in the env map", () => {
    const config = readTelemetryConfig({
      TELEMETRY_ENDPOINT: undefined,
      TELEMETRY_API_KEY: undefined,
      TELEMETRY_ENABLED: undefined,
    });
    expect(config).toEqual({ endpoint: "", apiKey: "", enabled: false });
  });
});

describe("isTelemetryEnabled", () => {
  it("returns true when enabled and endpoint is set", () => {
    expect(isTelemetryEnabled({ endpoint: "http://x", apiKey: "", enabled: true })).toBe(true);
  });

  it("returns false when enabled but endpoint is empty", () => {
    expect(isTelemetryEnabled({ endpoint: "", apiKey: "key", enabled: true })).toBe(false);
  });

  it("returns false when endpoint is set but enabled is false", () => {
    expect(isTelemetryEnabled({ endpoint: "http://x", apiKey: "key", enabled: false })).toBe(false);
  });

  it("returns false when both disabled and no endpoint", () => {
    expect(isTelemetryEnabled({ endpoint: "", apiKey: "", enabled: false })).toBe(false);
  });
});
