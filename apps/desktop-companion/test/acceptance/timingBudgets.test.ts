/**
 * T044 — SC-003 Cleanup Timing + SC-004 Resume Timing
 *
 * SC-003: 10-branch batch cleanup must complete in < 60 seconds.
 * SC-004: Single session resume must complete in < 3 seconds.
 *
 * Both tests use real git worktrees and real SQLite.
 */
import { describe, it, expect, afterEach } from "vitest";
import { vi } from "vitest";
import {
  createTestRepo,
  createTestWiring,
  cleanupWiring,
} from "../integration/helpers.js";
import type { TestWiring } from "../integration/helpers.js";

// ── SC-003: Batch cleanup ─────────────────────────────────────────────────────

describe("SC-003: Batch cleanup timing budget (< 60 seconds)", () => {
  let cleanups: Array<() => void> = [];
  let wirings: TestWiring[] = [];

  afterEach(async () => {
    for (const w of wirings) {
      await w.wiring.shutdown();
      w.wiring.store.close();
      cleanupWiring(w, w.dbDir);
    }
    for (const c of cleanups) {
      c();
    }
    cleanups = [];
    wirings = [];
  });

  it(
    "SC-003: 10-branch batch cleanup completes in < 60s",
    { timeout: 120_000 },
    async () => {
      const repo = await createTestRepo();
      cleanups.push(repo.cleanup);

      const testWiring = await createTestWiring({ pollIntervalMs: 60_000 });
      wirings.push(testWiring);
      const { wiring } = testWiring;

      // Create 10 branches via IPC events with unique session IDs and file paths
      const sessionIds = Array.from({ length: 10 }, (_, i) => `sc003-sess-${i}`);
      for (const sessionId of sessionIds) {
        wiring.detector.handleIpcEvent({
          sessionId,
          repoPath: repo.repoPath,
          filePath: `src/feature-${sessionId}.ts`,
        });
      }

      // Wait for all 10 TaskBranches to be created (real git worktree ops)
      await vi.waitFor(
        () => {
          const all = wiring.store.listAll();
          if (all.length < 10) {
            throw new Error(`Only ${all.length}/10 branches created`);
          }
        },
        { timeout: 60_000 },
      );

      const branches = wiring.store.listAll();
      expect(branches).toHaveLength(10);

      // Measure wall-clock time for batch force-delete (sequential, no uncommitted changes)
      const start = performance.now();
      for (const branch of branches) {
        await wiring.sessionManager.delete(branch.id, { force: true });
      }
      const elapsed = performance.now() - start;

      if (elapsed > 60_000) {
        console.warn(`SC-003 timing budget exceeded: ${elapsed.toFixed(0)}ms > 60000ms`);
      }

      expect(elapsed).toBeLessThan(60_000);
      expect(wiring.store.listAll()).toHaveLength(0);
    },
  );
});

// ── SC-004: Resume timing ────────────────────────────────────────────────────

describe("SC-004: Session resume timing budget (< 3 seconds)", () => {
  let cleanups: Array<() => void> = [];
  let wirings: TestWiring[] = [];

  afterEach(async () => {
    for (const w of wirings) {
      await w.wiring.shutdown();
      w.wiring.store.close();
      cleanupWiring(w, w.dbDir);
    }
    for (const c of cleanups) {
      c();
    }
    cleanups = [];
    wirings = [];
  });

  it("SC-004: single session resume completes in < 3s", async () => {
    const repo = await createTestRepo();
    cleanups.push(repo.cleanup);

    const testWiring = await createTestWiring({ pollIntervalMs: 60_000 });
    wirings.push(testWiring);
    const { wiring } = testWiring;

    // Create one TaskBranch with a real worktree
    wiring.detector.handleIpcEvent({
      sessionId: "sc004-session",
      repoPath: repo.repoPath,
      filePath: "src/index.ts",
    });

    const branch = await vi.waitFor(
      () => {
        const b = wiring.store.findBySessionId("sc004-session");
        if (b === undefined) throw new Error("not yet");
        return b;
      },
      { timeout: 15_000 },
    );

    // Measure resume time: isWorktreeHealthy + updateStatus + polling restart
    const start = performance.now();
    const resumed = await wiring.sessionManager.resume(branch.id);
    const elapsed = performance.now() - start;

    if (elapsed > 3_000) {
      console.warn(`SC-004 timing budget exceeded: ${elapsed.toFixed(0)}ms > 3000ms`);
    }

    expect(elapsed).toBeLessThan(3_000);
    expect(resumed.status).toBe("active");
  });
});
