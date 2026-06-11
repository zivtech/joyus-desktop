import { describe, expect, it } from "vitest";
import { selectRuntimeTarget, shouldFailClosed } from "../src/runtimeRouting";

describe("selectRuntimeTarget", () => {
  it("forces remote for external tenants", () => {
    expect(selectRuntimeTarget("external", true)).toBe("remote");
    expect(selectRuntimeTarget("external", false)).toBe("remote");
  });

  it("allows local for internal tenants when enabled", () => {
    expect(selectRuntimeTarget("internal", true)).toBe("local");
  });

  it("uses remote for internal tenants when local is disabled", () => {
    expect(selectRuntimeTarget("internal", false)).toBe("remote");
  });
});

describe("shouldFailClosed", () => {
  it("does not fail closed when policy is available", () => {
    expect(shouldFailClosed("high", true, "external")).toBe(false);
  });

  it("fails closed for external medium/high when policy unavailable", () => {
    expect(shouldFailClosed("medium", false, "external")).toBe(true);
    expect(shouldFailClosed("high", false, "external")).toBe(true);
  });

  it("does not fail closed for external low when policy unavailable", () => {
    expect(shouldFailClosed("low", false, "external")).toBe(false);
  });

  it("fails closed for internal high when policy unavailable", () => {
    expect(shouldFailClosed("high", false, "internal")).toBe(true);
  });

  it("does not fail closed for internal low/medium when policy unavailable", () => {
    expect(shouldFailClosed("low", false, "internal")).toBe(false);
    expect(shouldFailClosed("medium", false, "internal")).toBe(false);
  });
});
