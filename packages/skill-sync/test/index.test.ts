import { describe, expect, it } from "vitest";
import {
  readSyncMetadata,
  resolveHomePath,
  resolvePinnedVersion,
  syncSkills,
  writeSyncMetadata
} from "../src/index";

describe("index exports", () => {
  it("exports public api", () => {
    expect(typeof syncSkills).toBe("function");
    expect(typeof resolveHomePath).toBe("function");
    expect(typeof resolvePinnedVersion).toBe("function");
    expect(typeof readSyncMetadata).toBe("function");
    expect(typeof writeSyncMetadata).toBe("function");
  });
});
