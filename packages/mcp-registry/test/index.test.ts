import { describe, expect, it } from "vitest";
import {
  createProcessManager,
  createRegistry,
  mergeMcpConfig,
  removeManagedEntries,
  writeMcpConfig,
  removeMcpConfig,
  checkForUpdates,
  applyUpdate,
  rollback,
} from "../src/index";

describe("index re-exports", () => {
  it("exports processManager functions", () => {
    expect(createProcessManager).toBeTypeOf("function");
  });

  it("exports registry functions", () => {
    expect(createRegistry).toBeTypeOf("function");
  });

  it("exports claudeCodeIntegration functions", () => {
    expect(mergeMcpConfig).toBeTypeOf("function");
    expect(removeManagedEntries).toBeTypeOf("function");
    expect(writeMcpConfig).toBeTypeOf("function");
    expect(removeMcpConfig).toBeTypeOf("function");
  });

  it("exports updaterIntegration functions", () => {
    expect(checkForUpdates).toBeTypeOf("function");
    expect(applyUpdate).toBeTypeOf("function");
    expect(rollback).toBeTypeOf("function");
  });
});
