import { describe, expect, it } from "vitest";
import { evaluateHeuristics } from "../src/index.js";
import type { DriftThresholds } from "../../../kitty-specs/006-managed-git-sessions/contracts/drift-detector.js";

const DEFAULT_THRESHOLDS: DriftThresholds = {
  directoryCount: 3,
  topicDomainCount: 2,
  elapsedMinutes: 30,
};

const SESSION_START = 1_000_000;

function makeParams(paths: string[], elapsedMs = 0) {
  return {
    observedPaths: new Set(paths),
    sessionStartedAt: SESSION_START,
    nowMs: SESSION_START + elapsedMs,
  };
}

describe("evaluateHeuristics", () => {
  it("returns all zeros for empty path set", () => {
    const result = evaluateHeuristics(makeParams([]), DEFAULT_THRESHOLDS);
    expect(result.directoryCount).toBe(0);
    expect(result.topicDomainCount).toBe(0);
    expect(result.elapsedMinutes).toBe(0);
    expect(result.thresholdsExceeded).toBe(0);
  });

  it("counts distinct top-level directories", () => {
    const result = evaluateHeuristics(
      makeParams(["src/a.ts", "src/b.ts", "api/c.ts"]),
      DEFAULT_THRESHOLDS
    );
    expect(result.directoryCount).toBe(2);
  });

  it("counts distinct non-other topic domains", () => {
    const result = evaluateHeuristics(
      makeParams(["src/components/A.tsx", "api/routes/B.ts"]),
      DEFAULT_THRESHOLDS
    );
    expect(result.topicDomainCount).toBe(2);
  });

  it("does not count 'other' domain toward topicDomainCount", () => {
    const result = evaluateHeuristics(
      makeParams(["unknown/mystery.xyz", "random/file.abc"]),
      DEFAULT_THRESHOLDS
    );
    expect(result.topicDomainCount).toBe(0);
  });

  it("correctly computes elapsed minutes", () => {
    const result = evaluateHeuristics(
      makeParams([], 30 * 60_000),
      DEFAULT_THRESHOLDS
    );
    expect(result.elapsedMinutes).toBe(30);
  });

  it("sets directoryExceeded when directoryCount >= threshold", () => {
    const result = evaluateHeuristics(
      makeParams(["a/x.ts", "b/x.ts", "c/x.ts"]),
      DEFAULT_THRESHOLDS
    );
    expect(result.directoryExceeded).toBe(true);
    expect(result.directoryCount).toBe(3);
  });

  it("does not set directoryExceeded for count below threshold", () => {
    const result = evaluateHeuristics(
      makeParams(["a/x.ts", "b/x.ts"]),
      DEFAULT_THRESHOLDS
    );
    expect(result.directoryExceeded).toBe(false);
  });

  it("sets topicDomainExceeded when topicDomainCount >= threshold", () => {
    const result = evaluateHeuristics(
      makeParams(["src/components/A.tsx", "api/routes/B.ts"]),
      DEFAULT_THRESHOLDS
    );
    expect(result.topicDomainExceeded).toBe(true);
  });

  it("sets elapsedExceeded at exactly 30 minutes", () => {
    const result = evaluateHeuristics(
      makeParams([], 30 * 60_000),
      DEFAULT_THRESHOLDS
    );
    expect(result.elapsedExceeded).toBe(true);
  });

  it("exposes threshold values in result", () => {
    const result = evaluateHeuristics(makeParams([]), DEFAULT_THRESHOLDS);
    expect(result.directoryThreshold).toBe(3);
    expect(result.topicDomainThreshold).toBe(2);
    expect(result.elapsedThresholdMinutes).toBe(30);
  });

  it("counts thresholdsExceeded correctly for multiple exceeded", () => {
    const result = evaluateHeuristics(
      makeParams(
        ["a/components/X.tsx", "b/api/Y.ts", "c/scripts/Z.sh"],
        45 * 60_000
      ),
      DEFAULT_THRESHOLDS
    );
    expect(result.thresholdsExceeded).toBe(3);
  });
});
