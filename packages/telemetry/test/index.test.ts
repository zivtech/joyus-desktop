import { describe, expect, it } from "vitest";
import * as telemetry from "../src/index";

describe("index exports", () => {
  it("exports schema types and functions", () => {
    expect(telemetry.SCHEMA_VERSION).toBe("v1");
    expect(typeof telemetry.createTelemetryEvent).toBe("function");
    expect(typeof telemetry.validateTelemetryEvent).toBe("function");
  });

  it("exports optOut functions", () => {
    expect(typeof telemetry.isOptedOut).toBe("function");
    expect(typeof telemetry.createEnvOptOutReader).toBe("function");
    expect(typeof telemetry.createConfigOptOutReader).toBe("function");
    expect(typeof telemetry.resolveOptOut).toBe("function");
  });

  it("exports telemetryClient functions", () => {
    expect(typeof telemetry.sendTelemetryEvent).toBe("function");
    expect(typeof telemetry.sendTelemetryBatch).toBe("function");
  });

  it("exports cliCollector functions", () => {
    expect(typeof telemetry.createEventBuffer).toBe("function");
    expect(typeof telemetry.bufferEvent).toBe("function");
    expect(typeof telemetry.collectCliEvent).toBe("function");
    expect(typeof telemetry.flushBuffer).toBe("function");
  });

  it("exports coworkCollector functions", () => {
    expect(typeof telemetry.collectCoworkEvent).toBe("function");
  });

  it("exports usageReport functions", () => {
    expect(typeof telemetry.computeUsageMetrics).toBe("function");
    expect(typeof telemetry.formatUsageReport).toBe("function");
  });
});
