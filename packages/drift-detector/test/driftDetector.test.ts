import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createDriftDetector, NoOpDriftConfirmer, DEFAULT_DRIFT_THRESHOLDS } from "../src/index.js";
import type { DriftConfirmer, DriftDetector } from "../../../kitty-specs/006-managed-git-sessions/contracts/drift-detector.js";

const SESSION_START = 1_000_000;
const BRANCH_ID = "task-branch-001";

// Helper to build observe params
function obs(filePath: string, sessionStartedAt = SESSION_START) {
  return { taskBranchId: BRANCH_ID, filePath, sessionStartedAt };
}

// Paths for 3 dirs, 2 domains (frontend + backend)
const PATH_FRONTEND_A = "src/components/Button.tsx";   // dir=src, domain=frontend
const PATH_FRONTEND_B = "src/pages/Home.tsx";           // dir=src, domain=frontend
const PATH_BACKEND_A  = "api/routes/users.ts";          // dir=api, domain=backend
const PATH_DOCS_A     = "docs/readme.md";               // dir=docs, domain=documentation

describe("NoOpDriftConfirmer", () => {
  it("confirm always returns null", async () => {
    const confirmer: DriftConfirmer = new NoOpDriftConfirmer();
    const result = await confirmer.confirm({
      taskBranchId: "x",
      heuristics: {
        directoryCount: 0,
        directoryThreshold: 3,
        directoryExceeded: false,
        topicDomainCount: 0,
        topicDomainThreshold: 2,
        topicDomainExceeded: false,
        elapsedMinutes: 0,
        elapsedThresholdMinutes: 30,
        elapsedExceeded: false,
        thresholdsExceeded: 0,
      },
      observedPaths: new Set(),
    });
    expect(result).toBeNull();
  });
});

describe("DEFAULT_DRIFT_THRESHOLDS", () => {
  it("has correct defaults", () => {
    expect(DEFAULT_DRIFT_THRESHOLDS.directoryCount).toBe(3);
    expect(DEFAULT_DRIFT_THRESHOLDS.topicDomainCount).toBe(2);
    expect(DEFAULT_DRIFT_THRESHOLDS.elapsedMinutes).toBe(30);
  });
});

describe("createDriftDetector", () => {
  it("creates detector with default thresholds when no deps provided", () => {
    const detector = createDriftDetector();
    expect(detector).toBeDefined();
  });

  it("creates detector with custom confirmer", async () => {
    const mockConfirmer: DriftConfirmer = {
      confirm: vi.fn().mockResolvedValue(null),
    };
    const detector = createDriftDetector({ confirmer: mockConfirmer });
    // Trigger a signal: 3 dirs, 2 domains
    await detector.observe({ taskBranchId: BRANCH_ID, filePath: PATH_FRONTEND_A, sessionStartedAt: SESSION_START });
    await detector.observe({ taskBranchId: BRANCH_ID, filePath: PATH_BACKEND_A, sessionStartedAt: SESSION_START });
    await detector.observe({ taskBranchId: BRANCH_ID, filePath: PATH_DOCS_A, sessionStartedAt: SESSION_START });
    expect(mockConfirmer.confirm).toHaveBeenCalled();
  });
});

// ─── 15-Scenario Corpus ──────────────────────────────────────────────────────

describe("Drift corpus — should fire", () => {
  let detector: DriftDetector;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(SESSION_START);
    detector = createDriftDetector();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Scenario 1: 3 dirs, 1 domain, 0 min → low
  it("SC-1: 3 dirs, 1 domain, 0 min → low confidence", async () => {
    // All frontend domain, but 3 dirs
    await detector.observe({ taskBranchId: BRANCH_ID, filePath: "src/components/A.tsx", sessionStartedAt: SESSION_START });
    await detector.observe({ taskBranchId: BRANCH_ID, filePath: "lib/components/B.tsx", sessionStartedAt: SESSION_START });
    const signal = await detector.observe({ taskBranchId: BRANCH_ID, filePath: "shared/components/C.tsx", sessionStartedAt: SESSION_START });
    expect(signal).not.toBeNull();
    expect(signal?.confidence).toBe("low");
  });

  // Scenario 2: 1 dir, 2 domains, 0 min → low
  it("SC-2: 1 dir, 2 domains, 0 min → low confidence", async () => {
    await detector.observe({ taskBranchId: BRANCH_ID, filePath: "src/components/A.tsx", sessionStartedAt: SESSION_START });
    const signal = await detector.observe({ taskBranchId: BRANCH_ID, filePath: "src/api/B.ts", sessionStartedAt: SESSION_START });
    expect(signal).not.toBeNull();
    expect(signal?.confidence).toBe("low");
  });

  // Scenario 3: 1 dir, 1 domain, 30 min → low
  it("SC-3: 1 dir, 1 domain, 30 min → low confidence", async () => {
    vi.setSystemTime(SESSION_START + 30 * 60_000);
    const signal = await detector.observe({ taskBranchId: BRANCH_ID, filePath: "src/components/A.tsx", sessionStartedAt: SESSION_START });
    expect(signal).not.toBeNull();
    expect(signal?.confidence).toBe("low");
  });

  // Scenario 4: 3 dirs, 2 domains, 0 min → high
  it("SC-4: 3 dirs, 2 domains, 0 min → high confidence", async () => {
    await detector.observe({ taskBranchId: BRANCH_ID, filePath: PATH_FRONTEND_A, sessionStartedAt: SESSION_START });
    await detector.observe({ taskBranchId: BRANCH_ID, filePath: PATH_BACKEND_A, sessionStartedAt: SESSION_START });
    const signal = await detector.observe({ taskBranchId: BRANCH_ID, filePath: PATH_DOCS_A, sessionStartedAt: SESSION_START });
    expect(signal).not.toBeNull();
    expect(signal?.confidence).toBe("high");
  });

  // Scenario 5: 3 dirs, 1 domain, 30 min → high
  it("SC-5: 3 dirs, 1 domain, 30 min → high confidence", async () => {
    vi.setSystemTime(SESSION_START + 30 * 60_000);
    await detector.observe({ taskBranchId: BRANCH_ID, filePath: "src/components/A.tsx", sessionStartedAt: SESSION_START });
    await detector.observe({ taskBranchId: BRANCH_ID, filePath: "lib/components/B.tsx", sessionStartedAt: SESSION_START });
    const signal = await detector.observe({ taskBranchId: BRANCH_ID, filePath: "shared/components/C.tsx", sessionStartedAt: SESSION_START });
    expect(signal).not.toBeNull();
    expect(signal?.confidence).toBe("high");
  });

  // Scenario 6: 1 dir, 2 domains, 30 min → high
  it("SC-6: 1 dir, 2 domains, 30 min → high confidence", async () => {
    vi.setSystemTime(SESSION_START + 30 * 60_000);
    await detector.observe({ taskBranchId: BRANCH_ID, filePath: "src/components/A.tsx", sessionStartedAt: SESSION_START });
    const signal = await detector.observe({ taskBranchId: BRANCH_ID, filePath: "src/api/B.ts", sessionStartedAt: SESSION_START });
    expect(signal).not.toBeNull();
    expect(signal?.confidence).toBe("high");
  });

  // Scenario 7: 4 dirs, 3 domains, 45 min → high
  it("SC-7: 4 dirs, 3 domains, 45 min → high confidence", async () => {
    vi.setSystemTime(SESSION_START + 45 * 60_000);
    await detector.observe({ taskBranchId: BRANCH_ID, filePath: "src/components/A.tsx", sessionStartedAt: SESSION_START });
    await detector.observe({ taskBranchId: BRANCH_ID, filePath: "api/routes/B.ts", sessionStartedAt: SESSION_START });
    await detector.observe({ taskBranchId: BRANCH_ID, filePath: "scripts/build.sh", sessionStartedAt: SESSION_START });
    const signal = await detector.observe({ taskBranchId: BRANCH_ID, filePath: "test/e2e/C.test.ts", sessionStartedAt: SESSION_START });
    expect(signal).not.toBeNull();
    expect(signal?.confidence).toBe("high");
  });

  // Scenario 8: 3 dirs exactly, 0 min → low
  it("SC-8: exactly 3 dirs, 0 min → low confidence", async () => {
    await detector.observe({ taskBranchId: BRANCH_ID, filePath: "a/file.xyz", sessionStartedAt: SESSION_START });
    await detector.observe({ taskBranchId: BRANCH_ID, filePath: "b/file.xyz", sessionStartedAt: SESSION_START });
    const signal = await detector.observe({ taskBranchId: BRANCH_ID, filePath: "c/file.xyz", sessionStartedAt: SESSION_START });
    expect(signal).not.toBeNull();
    expect(signal?.confidence).toBe("low");
  });

  // Scenario 9: 2 domains exactly, 0 min → low
  it("SC-9: exactly 2 domains, 0 min → low confidence", async () => {
    await detector.observe({ taskBranchId: BRANCH_ID, filePath: "src/components/A.tsx", sessionStartedAt: SESSION_START });
    const signal = await detector.observe({ taskBranchId: BRANCH_ID, filePath: "src/api/B.ts", sessionStartedAt: SESSION_START });
    expect(signal).not.toBeNull();
    expect(signal?.confidence).toBe("low");
  });

  // Scenario 10: 0 dirs/domains, 30 min exactly → low
  it("SC-10: 0 dirs, 0 non-other domains, 30 min exactly → low confidence", async () => {
    vi.setSystemTime(SESSION_START + 30 * 60_000);
    // A path with no recognized dir/domain still triggers elapsed threshold
    const signal = await detector.observe({ taskBranchId: BRANCH_ID, filePath: "unknown/mystery.xyz", sessionStartedAt: SESSION_START });
    expect(signal).not.toBeNull();
    expect(signal?.confidence).toBe("low");
  });
});

describe("Drift corpus — should not fire", () => {
  let detector: DriftDetector;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(SESSION_START);
    detector = createDriftDetector();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Scenario 1: 2 dirs, 1 domain, 25 min → null
  it("SC-NF-1: 2 dirs, 1 domain, 25 min → null", async () => {
    vi.setSystemTime(SESSION_START + 25 * 60_000);
    await detector.observe({ taskBranchId: BRANCH_ID, filePath: "src/components/A.tsx", sessionStartedAt: SESSION_START });
    const signal = await detector.observe({ taskBranchId: BRANCH_ID, filePath: "lib/components/B.tsx", sessionStartedAt: SESSION_START });
    expect(signal).toBeNull();
  });

  // Scenario 2: Same as SC-4 but fingerprint dismissed → null
  it("SC-NF-2: dismissed fingerprint → null on re-observe", async () => {
    await detector.observe({ taskBranchId: BRANCH_ID, filePath: PATH_FRONTEND_A, sessionStartedAt: SESSION_START });
    await detector.observe({ taskBranchId: BRANCH_ID, filePath: PATH_BACKEND_A, sessionStartedAt: SESSION_START });
    const signal = await detector.observe({ taskBranchId: BRANCH_ID, filePath: PATH_DOCS_A, sessionStartedAt: SESSION_START });
    expect(signal).not.toBeNull();

    // Dismiss the signal
    detector.dismiss(signal!);

    // Same state → null
    const signal2 = await detector.observe({ taskBranchId: BRANCH_ID, filePath: "src/styles/main.css", sessionStartedAt: SESSION_START });
    expect(signal2).toBeNull();
  });

  // Scenario 3: clearSession then re-observe → fires again
  it("SC-NF-3: clearSession then re-observe fires again", async () => {
    await detector.observe({ taskBranchId: BRANCH_ID, filePath: PATH_FRONTEND_A, sessionStartedAt: SESSION_START });
    await detector.observe({ taskBranchId: BRANCH_ID, filePath: PATH_BACKEND_A, sessionStartedAt: SESSION_START });
    const signal1 = await detector.observe({ taskBranchId: BRANCH_ID, filePath: PATH_DOCS_A, sessionStartedAt: SESSION_START });
    expect(signal1).not.toBeNull();

    detector.clearSession(BRANCH_ID);
    expect(detector.getState(BRANCH_ID)).toBeUndefined();

    // Re-observe after clear — same paths → should fire again
    await detector.observe({ taskBranchId: BRANCH_ID, filePath: PATH_FRONTEND_A, sessionStartedAt: SESSION_START });
    await detector.observe({ taskBranchId: BRANCH_ID, filePath: PATH_BACKEND_A, sessionStartedAt: SESSION_START });
    const signal2 = await detector.observe({ taskBranchId: BRANCH_ID, filePath: PATH_DOCS_A, sessionStartedAt: SESSION_START });
    expect(signal2).not.toBeNull();
    expect(signal2?.confidence).toBe("high");
  });

  // Scenario 4: 0 paths, 0 min → null
  it("SC-NF-4: 0 paths observed returns null (no observe calls, getState undefined)", () => {
    expect(detector.getState(BRANCH_ID)).toBeUndefined();
  });

  // Scenario 5: 2 dirs, 0 non-other domains, 0 min → null
  it("SC-NF-5: 2 dirs, 0 non-other domains, 0 min → null", async () => {
    await detector.observe({ taskBranchId: BRANCH_ID, filePath: "foo/unknown.xyz", sessionStartedAt: SESSION_START });
    const signal = await detector.observe({ taskBranchId: BRANCH_ID, filePath: "bar/unknown.abc", sessionStartedAt: SESSION_START });
    expect(signal).toBeNull();
  });
});

describe("DriftDetector additional behaviors", () => {
  let detector: DriftDetector;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(SESSION_START);
    detector = createDriftDetector();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("observe accumulates paths across multiple calls", async () => {
    await detector.observe(obs("src/components/A.tsx"));
    await detector.observe(obs("api/routes/B.ts"));

    const state = detector.getState(BRANCH_ID);
    expect(state?.observedPaths.has("src/components/A.tsx")).toBe(true);
    expect(state?.observedPaths.has("api/routes/B.ts")).toBe(true);
  });

  it("dismiss stores fingerprint and blocks re-prompt", async () => {
    await detector.observe({ taskBranchId: BRANCH_ID, filePath: PATH_FRONTEND_A, sessionStartedAt: SESSION_START });
    await detector.observe({ taskBranchId: BRANCH_ID, filePath: PATH_BACKEND_A, sessionStartedAt: SESSION_START });
    const signal = await detector.observe({ taskBranchId: BRANCH_ID, filePath: PATH_DOCS_A, sessionStartedAt: SESSION_START });
    expect(signal).not.toBeNull();

    detector.dismiss(signal!);

    const state = detector.getState(BRANCH_ID);
    expect(state?.dismissedFingerprints.size).toBeGreaterThan(0);

    // Re-observe should be blocked
    const signal2 = await detector.observe({ taskBranchId: BRANCH_ID, filePath: "src/extra.tsx", sessionStartedAt: SESSION_START });
    expect(signal2).toBeNull();
  });

  it("getState returns current snapshot without evaluating thresholds", async () => {
    await detector.observe(obs("src/components/A.tsx"));
    const state = detector.getState(BRANCH_ID);
    expect(state).not.toBeUndefined();
    expect(state?.taskBranchId).toBe(BRANCH_ID);
    expect(state?.observedPaths.size).toBe(1);
  });

  it("dismiss on unknown taskBranchId does not throw", async () => {
    // Need a valid signal with the right structure
    await detector.observe({ taskBranchId: BRANCH_ID, filePath: PATH_FRONTEND_A, sessionStartedAt: SESSION_START });
    await detector.observe({ taskBranchId: BRANCH_ID, filePath: PATH_BACKEND_A, sessionStartedAt: SESSION_START });
    const signal = await detector.observe({ taskBranchId: BRANCH_ID, filePath: PATH_DOCS_A, sessionStartedAt: SESSION_START });
    expect(signal).not.toBeNull();

    // Dismiss with a different taskBranchId — should not throw
    expect(() => detector.dismiss({ ...signal!, taskBranchId: "nonexistent" })).not.toThrow();
  });

  it("clearSession removes all state", async () => {
    await detector.observe(obs("src/components/A.tsx"));
    expect(detector.getState(BRANCH_ID)).not.toBeUndefined();
    detector.clearSession(BRANCH_ID);
    expect(detector.getState(BRANCH_ID)).toBeUndefined();
  });

  it("signal has correct shape", async () => {
    vi.setSystemTime(SESSION_START + 30 * 60_000);
    const signal = await detector.observe({ taskBranchId: BRANCH_ID, filePath: "src/components/A.tsx", sessionStartedAt: SESSION_START });
    expect(signal).not.toBeNull();
    expect(signal?.taskBranchId).toBe(BRANCH_ID);
    expect(signal?.explanation).toBeNull();
    expect(typeof signal?.generatedAt).toBe("number");
    expect(signal?.heuristics).toBeDefined();
  });

  it("custom thresholds are respected", async () => {
    // Lower threshold: 1 dir triggers
    const strictDetector = createDriftDetector({
      thresholds: { directoryCount: 1 },
    });
    const signal = await strictDetector.observe({ taskBranchId: BRANCH_ID, filePath: "src/components/A.tsx", sessionStartedAt: SESSION_START });
    expect(signal).not.toBeNull();
    expect(signal?.confidence).toBe("low");
  });

  it("partial thresholds fall back to defaults for missing fields", async () => {
    vi.setSystemTime(SESSION_START + 30 * 60_000);
    // Only override elapsedMinutes; directoryCount and topicDomainCount use defaults
    const detector2 = createDriftDetector({
      thresholds: { elapsedMinutes: 30 },
    });
    const signal = await detector2.observe({ taskBranchId: BRANCH_ID, filePath: "src/components/A.tsx", sessionStartedAt: SESSION_START });
    expect(signal).not.toBeNull();
    expect(signal?.confidence).toBe("low");
  });
});
