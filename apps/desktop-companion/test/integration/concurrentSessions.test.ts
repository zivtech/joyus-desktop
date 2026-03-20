/**
 * WP06 Integration Tests — Concurrent Session Isolation
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync } from "node:fs";
import {
  createTestRepo,
  createTestWiring,
  cleanupWiring,
} from "./helpers.js";
import type { TestWiring } from "./helpers.js";

describe("Concurrent session isolation", () => {
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

  it("creates distinct worktrees for two concurrent sessions", async () => {
    const { wiring } = testWiring;

    // Fire two events concurrently
    wiring.detector.handleIpcEvent({
      sessionId: "session-A",
      repoPath,
      filePath: "src/a.ts",
    });
    wiring.detector.handleIpcEvent({
      sessionId: "session-B",
      repoPath,
      filePath: "src/b.ts",
    });

    // Wait for both to be created
    await vi.waitFor(
      () => {
        if (wiring.store.listAll().length < 2) {
          throw new Error("not all sessions created yet");
        }
      },
      { timeout: 10000 },
    );

    const branchA = wiring.store.findBySessionId("session-A")!;
    const branchB = wiring.store.findBySessionId("session-B")!;

    expect(branchA).toBeDefined();
    expect(branchB).toBeDefined();
    expect(branchA.worktreePath).not.toBe(branchB.worktreePath);
    expect(branchA.branchName).not.toBe(branchB.branchName);
    expect(existsSync(branchA.worktreePath)).toBe(true);
    expect(existsSync(branchB.worktreePath)).toBe(true);
    expect(branchA.sessionId).toBe("session-A");
    expect(branchB.sessionId).toBe("session-B");
  });

  it("updates lastActivityAt on subsequent event for same session without creating a new branch", async () => {
    const { wiring } = testWiring;

    wiring.detector.handleIpcEvent({
      sessionId: "session-A",
      repoPath,
      filePath: "src/a.ts",
    });
    wiring.detector.handleIpcEvent({
      sessionId: "session-B",
      repoPath,
      filePath: "src/b.ts",
    });

    await vi.waitFor(
      () => {
        if (wiring.store.listAll().length < 2) {
          throw new Error("not all sessions created yet");
        }
      },
      { timeout: 10000 },
    );

    const branchABefore = wiring.store.findBySessionId("session-A")!;
    const activityBefore = branchABefore.lastActivityAt;

    // Brief pause so timestamp can advance
    await new Promise((r) => setTimeout(r, 10));

    // Fire a third event for session-A
    wiring.detector.handleIpcEvent({
      sessionId: "session-A",
      repoPath,
      filePath: "src/c.ts",
    });

    // Wait for lastActivityAt to be updated
    await vi.waitFor(
      () => {
        const b = wiring.store.findBySessionId("session-A");
        if (b === undefined || b.lastActivityAt <= activityBefore) {
          throw new Error("activity not updated yet");
        }
      },
      { timeout: 10000 },
    );

    // Still exactly 2 branches — no new one was created
    expect(wiring.store.listAll().length).toBe(2);
  });

  it("handles name collision — two sessions with same file get distinct branch names", async () => {
    const { wiring } = testWiring;

    // Both sessions edit only src/index.ts — same mission slug
    wiring.detector.handleIpcEvent({
      sessionId: "session-coll-1",
      repoPath,
      filePath: "src/index.ts",
    });

    // Wait for first to be created before firing second (to ensure collision retry logic runs)
    await vi.waitFor(
      () => {
        const b = wiring.store.findBySessionId("session-coll-1");
        if (b === undefined) throw new Error("not yet");
        return b;
      },
      { timeout: 10000 },
    );

    wiring.detector.handleIpcEvent({
      sessionId: "session-coll-2",
      repoPath,
      filePath: "src/index.ts",
    });

    await vi.waitFor(
      () => {
        if (wiring.store.listAll().length < 2) {
          throw new Error("second session not created yet");
        }
      },
      { timeout: 10000 },
    );

    const b1 = wiring.store.findBySessionId("session-coll-1")!;
    const b2 = wiring.store.findBySessionId("session-coll-2")!;

    expect(b1.branchName).not.toBe(b2.branchName);
    expect(b2.branchName).toMatch(/-2$/);
  });
});
