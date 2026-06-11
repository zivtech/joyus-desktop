import { describe, expect, it } from "vitest";
import {
  cloneOrUpdate,
  copySkillsAtomic,
  createPeriodicSync,
  ensureCloneDir,
  hasVersionChanged,
  isNetworkAvailable,
  readCloneMetadata,
  readVersionPin,
  startupSync,
  updateSyncMetadata,
} from "../src/index";

describe("index re-exports", () => {
  it("exports cloneManager functions", () => {
    expect(ensureCloneDir).toBeTypeOf("function");
    expect(cloneOrUpdate).toBeTypeOf("function");
    expect(copySkillsAtomic).toBeTypeOf("function");
    expect(readCloneMetadata).toBeTypeOf("function");
    expect(isNetworkAvailable).toBeTypeOf("function");
  });

  it("exports versionPin functions", () => {
    expect(readVersionPin).toBeTypeOf("function");
    expect(hasVersionChanged).toBeTypeOf("function");
    expect(updateSyncMetadata).toBeTypeOf("function");
  });

  it("exports syncLifecycle functions", () => {
    expect(startupSync).toBeTypeOf("function");
    expect(createPeriodicSync).toBeTypeOf("function");
  });
});
