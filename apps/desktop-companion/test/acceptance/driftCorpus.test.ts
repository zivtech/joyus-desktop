/**
 * T043 — SC-002: Drift Corpus Execution (15 Scenarios)
 *
 * Runs the full 15-scenario drift corpus from spec.md and asserts:
 * - ≥95% fire rate on the 10 "should fire" scenarios
 * - null for all 5 "should not fire" scenarios
 *
 * DEFAULT_DRIFT_THRESHOLDS = { directoryCount: 3, topicDomainCount: 2, elapsedMinutes: 30 }
 * Confidence: "high" if 2+ thresholds exceeded, "low" if exactly 1.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createDriftDetector,
  DEFAULT_DRIFT_THRESHOLDS,
} from "@joyus/drift-detector";
import type { DriftSignal } from "@joyus/drift-detector";

function freshId(): string {
  return `corpus-${randomUUID()}`;
}

/**
 * Observe a list of paths sequentially on a fresh detector instance.
 * Returns the result of the final observe() call.
 */
async function runScenario(
  paths: string[],
  elapsedMinutes: number,
): Promise<DriftSignal | null> {
  const detector = createDriftDetector({ thresholds: DEFAULT_DRIFT_THRESHOLDS });
  const id = freshId();
  const sessionStartedAt = Date.now() - elapsedMinutes * 60_000;
  let lastResult: DriftSignal | null = null;
  for (const filePath of paths) {
    lastResult = await detector.observe({ taskBranchId: id, filePath, sessionStartedAt });
  }
  return lastResult;
}

// ── "Should fire" scenarios (10) ────────────────────────────────────────────
// Each must return a DriftSignal (not null).

describe('SC-002: "Should fire" drift scenarios', () => {
  it("fires: 3 distinct top-level dirs, 1 topic domain, 0 min elapsed → low confidence", async () => {
    // dirs: {foo, bar, auth}=3 ≥ 3; domains: {security}=1 < 2; elapsed≈0
    // thresholdsExceeded=1 → low
    const result = await runScenario(
      ["foo/a.txt", "bar/b.txt", "auth/c.ts"],
      0,
    );
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe("low");
  });

  it("fires: 1 dir, 2 distinct topic domains, 0 min elapsed → low confidence", async () => {
    // dirs: {src}=1 < 3; domains: {frontend(components), security(auth)}=2 ≥ 2
    // thresholdsExceeded=1 → low
    const result = await runScenario(
      ["src/components/App.tsx", "src/auth/login.ts"],
      0,
    );
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe("low");
  });

  it("fires: 1 dir, 1 domain, 30 min elapsed → low confidence", async () => {
    // dirs: {src}=1 < 3; domains: {}=0 < 2; elapsed=30 ≥ 30
    // thresholdsExceeded=1 → low
    const result = await runScenario(["src/app.ts"], 30);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe("low");
  });

  it("fires: 3 dirs, 2 domains, 0 min elapsed → high confidence", async () => {
    // dirs: {src, test, auth}=3 ≥ 3; domains: {frontend, testing, security}=3 ≥ 2
    // thresholdsExceeded=2 → high
    const result = await runScenario(
      ["src/components/App.tsx", "test/unit/foo.ts", "auth/login.ts"],
      0,
    );
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe("high");
  });

  it("fires: 3 dirs, 1 domain, 30 min elapsed → high confidence", async () => {
    // dirs: {foo, bar, auth}=3 ≥ 3; domains: {security}=1 < 2; elapsed=31 ≥ 30
    // thresholdsExceeded=2 (directory + elapsed) → high
    const result = await runScenario(
      ["foo/a.txt", "bar/b.txt", "auth/c.ts"],
      31,
    );
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe("high");
  });

  it("fires: 1 dir, 2 domains, 30 min elapsed → high confidence", async () => {
    // dirs: {src}=1 < 3; domains: {frontend, security}=2 ≥ 2; elapsed=31 ≥ 30
    // thresholdsExceeded=2 (topicDomain + elapsed) → high
    const result = await runScenario(
      ["src/components/App.tsx", "src/auth/login.ts"],
      31,
    );
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe("high");
  });

  it("fires: 4 dirs, 3 domains, 45 min elapsed → high confidence", async () => {
    // dirs: {src, docs, auth, scripts}=4 ≥ 3
    // domains: {frontend, documentation, security, tooling}=4 ≥ 2; elapsed=46 ≥ 30
    // thresholdsExceeded=3 → high
    const result = await runScenario(
      [
        "src/components/App.tsx", // src → frontend
        "docs/readme.md",         // docs → documentation
        "auth/login.ts",          // auth → security
        "scripts/build.sh",       // scripts → tooling
      ],
      46,
    );
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe("high");
  });

  it("fires: 3 dirs exactly at threshold, 0 non-other domains, 0 min → low confidence", async () => {
    // Boundary: directoryCount=3 is AT the threshold (≥3 fires)
    // dirs: {alpha, beta, gamma}=3; domains: {}=0 < 2; elapsed≈0
    // thresholdsExceeded=1 → low
    const result = await runScenario(
      ["alpha/a.txt", "beta/b.txt", "gamma/c.txt"],
      0,
    );
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe("low");
  });

  it("fires: 2 domains exactly at threshold, 1 dir, 0 min → low confidence", async () => {
    // Boundary: topicDomainCount=2 is AT the threshold (≥2 fires)
    // dirs: {src}=1 < 3; domains: {frontend, security}=2 ≥ 2; elapsed≈0
    // thresholdsExceeded=1 → low
    const result = await runScenario(
      ["src/components/App.tsx", "src/auth/login.ts"],
      0,
    );
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe("low");
  });

  it("fires: 0 dirs, 0 non-other domains, 30 min exactly elapsed → low confidence", async () => {
    // Empty path: directoryCount=0, topicDomainCount=0, elapsed=30 ≥ 30
    // thresholdsExceeded=1 → low
    const result = await runScenario([""], 30);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe("low");
  });
});

// ── Aggregate fire-rate assertion ────────────────────────────────────────────

describe("SC-002: ≥95% fire rate across all 10 should-fire scenarios", () => {
  it("fires in at least 95% of should-fire scenarios (ideally 100%)", async () => {
    const shouldFireScenarios: Array<{ paths: string[]; elapsed: number }> = [
      { paths: ["foo/a.txt", "bar/b.txt", "auth/c.ts"], elapsed: 0 },
      { paths: ["src/components/App.tsx", "src/auth/login.ts"], elapsed: 0 },
      { paths: ["src/app.ts"], elapsed: 30 },
      { paths: ["src/components/App.tsx", "test/unit/foo.ts", "auth/login.ts"], elapsed: 0 },
      { paths: ["foo/a.txt", "bar/b.txt", "auth/c.ts"], elapsed: 31 },
      { paths: ["src/components/App.tsx", "src/auth/login.ts"], elapsed: 31 },
      {
        paths: ["src/components/App.tsx", "docs/readme.md", "auth/login.ts", "scripts/build.sh"],
        elapsed: 46,
      },
      { paths: ["alpha/a.txt", "beta/b.txt", "gamma/c.txt"], elapsed: 0 },
      { paths: ["src/components/App.tsx", "src/auth/login.ts"], elapsed: 0 },
      { paths: [""], elapsed: 30 },
    ];

    const results = await Promise.all(
      shouldFireScenarios.map(({ paths, elapsed }) => runScenario(paths, elapsed)),
    );

    const firedCount = results.filter((r) => r !== null).length;
    const fireRate = firedCount / shouldFireScenarios.length;
    expect(fireRate).toBeGreaterThanOrEqual(0.95);
  });
});

// ── "Should not fire" scenarios (5) ─────────────────────────────────────────
// Each must return exactly null.

describe('SC-002: "Should not fire" drift scenarios', () => {
  it("does not fire: 2 dirs, 1 domain, 25 min elapsed → null", async () => {
    // dirs: {src, lib}=2 < 3; domains: {security}=1 < 2; elapsed=25 < 30
    // thresholdsExceeded=0 → null
    const result = await runScenario(
      ["src/app.ts", "lib/util.ts"],
      25,
    );
    expect(result).toBeNull();
  });

  it("does not fire: dismissed fingerprint suppresses re-observe → null", async () => {
    const detector = createDriftDetector({ thresholds: DEFAULT_DRIFT_THRESHOLDS });
    const id = freshId();
    const sessionStartedAt = Date.now();

    // Accumulate 3 dirs + 3 domains to get a signal (2 thresholds exceeded → high)
    await detector.observe({ taskBranchId: id, filePath: "src/components/App.tsx", sessionStartedAt });
    await detector.observe({ taskBranchId: id, filePath: "test/unit/foo.ts", sessionStartedAt });
    const firstSignal = await detector.observe({ taskBranchId: id, filePath: "auth/login.ts", sessionStartedAt });
    expect(firstSignal).not.toBeNull();

    // Dismiss the signal → fingerprint is recorded
    detector.dismiss(firstSignal!);

    // Re-observe same file → Set dedup → same fingerprint → null
    const second = await detector.observe({ taskBranchId: id, filePath: "auth/login.ts", sessionStartedAt });
    expect(second).toBeNull();
  });

  it("fires again after clearSession resets state (clearSession scenario)", async () => {
    // Not a "should not fire" but demonstrates clearSession correctly resets dismissals.
    const detector = createDriftDetector({ thresholds: DEFAULT_DRIFT_THRESHOLDS });
    const id = freshId();
    const sessionStartedAt = Date.now();

    // Build up state and fire once
    await detector.observe({ taskBranchId: id, filePath: "src/components/App.tsx", sessionStartedAt });
    await detector.observe({ taskBranchId: id, filePath: "test/unit/foo.ts", sessionStartedAt });
    const firstSignal = await detector.observe({ taskBranchId: id, filePath: "auth/login.ts", sessionStartedAt });
    expect(firstSignal).not.toBeNull();

    // Clear session state
    detector.clearSession(id);
    expect(detector.getState(id)).toBeUndefined();

    // Re-observe the same paths — state is fresh, fires again
    await detector.observe({ taskBranchId: id, filePath: "src/components/App.tsx", sessionStartedAt });
    await detector.observe({ taskBranchId: id, filePath: "test/unit/foo.ts", sessionStartedAt });
    const secondSignal = await detector.observe({ taskBranchId: id, filePath: "auth/login.ts", sessionStartedAt });
    expect(secondSignal).not.toBeNull();
  });

  it("does not fire: 0 paths observed, 0 min elapsed → null", async () => {
    // Empty string path: directoryCount=0, topicDomainCount=0, elapsed≈0
    // thresholdsExceeded=0 → null
    const result = await runScenario([""], 0);
    expect(result).toBeNull();
  });

  it("does not fire: 2 dirs, 0 non-other domains, 0 min elapsed → null", async () => {
    // dirs: {src, lib}=2 < 3; domains: {}=0 < 2; elapsed≈0
    // thresholdsExceeded=0 → null
    const result = await runScenario(["src/app.ts", "lib/util.ts"], 0);
    expect(result).toBeNull();
  });
});
