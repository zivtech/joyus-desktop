import { describe, expect, it } from "vitest";
import * as barrel from "../src/index";

describe("barrel re-exports", () => {
  it("exports wrapAsyncHandler", () => {
    expect(typeof barrel.wrapAsyncHandler).toBe("function");
  });

  it("exports governanceGuard", () => {
    expect(typeof barrel.governanceGuard).toBe("function");
  });

  it("exports readTelemetryConfig", () => {
    expect(typeof barrel.readTelemetryConfig).toBe("function");
  });

  it("exports isTelemetryEnabled", () => {
    expect(typeof barrel.isTelemetryEnabled).toBe("function");
  });
});
