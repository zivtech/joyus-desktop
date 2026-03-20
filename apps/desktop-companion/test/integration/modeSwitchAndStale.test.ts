/**
 * WP06 Integration Tests — Mode Switch Boundary and Stale Threshold
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createTestRepo,
  createTestWiring,
  cleanupWiring,
} from "./helpers.js";
import type { TestWiring } from "./helpers.js";

// ---------------------------------------------------------------------------
// Mode-switch boundary
// ---------------------------------------------------------------------------

describe("Mode-switch boundary", () => {
  let repoPath: string;
  let cleanup: () => void;
  let testWiring: TestWiring;

  beforeEach(async () => {
    const repo = await createTestRepo();
    repoPath = repo.repoPath;
    cleanup = repo.cleanup;
    testWiring = await createTestWiring();
  });

  afterEach(async () => {
    await testWiring.wiring.shutdown();
    testWiring.wiring.store.close();
    cleanup();
    cleanupWiring(testWiring, testWiring.dbDir);
  });

  it("blocks new sessions in advisory mode but allows them after switching back to managed", async () => {
    const { wiring } = testWiring;

    // Start managed — create session-X
    wiring.detector.handleIpcEvent({
      sessionId: "session-X",
      repoPath,
      filePath: "src/x.ts",
    });

    await vi.waitFor(
      () => {
        const b = wiring.store.findBySessionId("session-X");
        if (b === undefined) throw new Error("not yet");
        return b;
      },
      { timeout: 10000 },
    );

    // Switch to advisory
    wiring.sessionManager.setMode("advisory");

    // Fire event for session-Y — should be ignored
    wiring.detector.handleIpcEvent({
      sessionId: "session-Y",
      repoPath,
      filePath: "src/y.ts",
    });

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(wiring.store.findBySessionId("session-Y")).toBeUndefined();
    // session-X still exists
    expect(wiring.store.findBySessionId("session-X")).toBeDefined();

    // Switch back to managed
    wiring.sessionManager.setMode("managed");

    // Fire event for session-Z — should create a TaskBranch
    wiring.detector.handleIpcEvent({
      sessionId: "session-Z",
      repoPath,
      filePath: "src/z.ts",
    });

    await vi.waitFor(
      () => {
        const b = wiring.store.findBySessionId("session-Z");
        if (b === undefined) throw new Error("not yet");
        return b;
      },
      { timeout: 10000 },
    );

    expect(wiring.store.findBySessionId("session-Z")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Stale threshold boundary
// ---------------------------------------------------------------------------

describe("Stale threshold boundary", () => {
  let repoPath: string;
  let cleanup: () => void;
  let testWiring: TestWiring;

  beforeEach(async () => {
    const repo = await createTestRepo();
    repoPath = repo.repoPath;
    cleanup = repo.cleanup;
    testWiring = await createTestWiring({ staleDays: 14 });
  });

  afterEach(async () => {
    await testWiring.wiring.shutdown();
    testWiring.wiring.store.close();
    cleanup();
    cleanupWiring(testWiring, testWiring.dbDir);
  });

  it("only marks branches stale when lastActivityAt exceeds the threshold", async () => {
    const { wiring } = testWiring;

    // Create 4 sessions
    wiring.detector.handleIpcEvent({
      sessionId: "session-thr-a",
      repoPath,
      filePath: "src/a.ts",
    });
    wiring.detector.handleIpcEvent({
      sessionId: "session-thr-b",
      repoPath,
      filePath: "src/b.ts",
    });
    wiring.detector.handleIpcEvent({
      sessionId: "session-thr-c",
      repoPath,
      filePath: "src/c.ts",
    });
    wiring.detector.handleIpcEvent({
      sessionId: "session-thr-d",
      repoPath,
      filePath: "src/d.ts",
    });

    // Wait for all 4
    await vi.waitFor(
      () => {
        const a = wiring.store.findBySessionId("session-thr-a");
        const b = wiring.store.findBySessionId("session-thr-b");
        const c = wiring.store.findBySessionId("session-thr-c");
        const d = wiring.store.findBySessionId("session-thr-d");
        if (!a || !b || !c || !d) throw new Error("not all created yet");
      },
      { timeout: 10000 },
    );

    const branchA = wiring.store.findBySessionId("session-thr-a")!;
    const branchB = wiring.store.findBySessionId("session-thr-b")!;
    const branchC = wiring.store.findBySessionId("session-thr-c")!;
    const branchD = wiring.store.findBySessionId("session-thr-d")!;

    // A = 13 days ago (within threshold)
    wiring.store.updateActivity({
      taskBranchId: branchA.id,
      lastActivityAt: Date.now() - 13 * 24 * 60 * 60 * 1000,
    });
    // B = 15 days ago (past threshold)
    wiring.store.updateActivity({
      taskBranchId: branchB.id,
      lastActivityAt: Date.now() - 15 * 24 * 60 * 60 * 1000,
    });

    // Mark C as merged, D as broken
    wiring.store.updateStatus(branchC.id, "merged");
    wiring.store.updateStatus(branchD.id, "broken");

    // Apply threshold directly (14 days ago)
    wiring.store.applyStaleThreshold(Date.now() - 14 * 24 * 60 * 60 * 1000);

    expect(wiring.store.findById(branchA.id)!.status).toBe("active");  // 13 days < 14 day threshold
    expect(wiring.store.findById(branchB.id)!.status).toBe("stale");   // 15 days > 14 day threshold
    expect(wiring.store.findById(branchC.id)!.status).toBe("merged");  // unchanged
    expect(wiring.store.findById(branchD.id)!.status).toBe("broken");  // unchanged
  });
});
