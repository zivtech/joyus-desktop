/**
 * WP06 Integration Tests — Integrity Scan and Batch Cleanup
 * SC-007: Integrity scan marks broken worktrees
 * SC-008: Batch cleanup with partial failure
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFile as execFileCb } from "node:child_process";
import { rmSync } from "node:fs";
import { promisify } from "node:util";
import { SessionBrokenError } from "@joyus/session-manager";
import {
  createTestRepo,
  createTestWiring,
  cleanupWiring,
} from "./helpers.js";
import type { TestWiring } from "./helpers.js";

const execFile = promisify(execFileCb);

// ---------------------------------------------------------------------------
// SC-007: Integrity scan marks broken worktrees
// ---------------------------------------------------------------------------

describe("SC-007: Integrity scan marks broken worktrees", () => {
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

  it("marks a branch broken when its worktree directory is removed", async () => {
    const { wiring } = testWiring;

    wiring.detector.handleIpcEvent({
      sessionId: "session-sc7",
      repoPath,
      filePath: "src/index.ts",
    });

    const branch = await vi.waitFor(
      () => {
        const b = wiring.store.findBySessionId("session-sc7");
        if (b === undefined) throw new Error("not yet");
        return b;
      },
      { timeout: 10000 },
    );

    // Delete the worktree directory then prune so git un-registers it.
    // Without prune, git worktree list --porcelain still shows the path.
    rmSync(branch.worktreePath, { recursive: true, force: true });
    await execFile("git", ["worktree", "prune"], { cwd: repoPath });

    // Re-initialize triggers integrity scan
    await wiring.sessionManager.initialize();

    expect(wiring.store.findById(branch.id)!.status).toBe("broken");
  });

  it("is idempotent — re-scanning broken records does not crash", async () => {
    const { wiring } = testWiring;

    wiring.detector.handleIpcEvent({
      sessionId: "session-sc7-idem",
      repoPath,
      filePath: "src/index.ts",
    });

    const branch = await vi.waitFor(
      () => {
        const b = wiring.store.findBySessionId("session-sc7-idem");
        if (b === undefined) throw new Error("not yet");
        return b;
      },
      { timeout: 10000 },
    );

    rmSync(branch.worktreePath, { recursive: true, force: true });
    await execFile("git", ["worktree", "prune"], { cwd: repoPath });
    await wiring.sessionManager.initialize();
    expect(wiring.store.findById(branch.id)!.status).toBe("broken");

    // Second initialize — broken records are skipped in scanIntegrity, no crash
    await wiring.sessionManager.initialize();
    expect(wiring.store.findById(branch.id)!.status).toBe("broken");
  });

  it("throws SessionBrokenError when resuming a broken branch", async () => {
    const { wiring } = testWiring;

    wiring.detector.handleIpcEvent({
      sessionId: "session-sc7-resume",
      repoPath,
      filePath: "src/index.ts",
    });

    const branch = await vi.waitFor(
      () => {
        const b = wiring.store.findBySessionId("session-sc7-resume");
        if (b === undefined) throw new Error("not yet");
        return b;
      },
      { timeout: 10000 },
    );

    rmSync(branch.worktreePath, { recursive: true, force: true });
    await execFile("git", ["worktree", "prune"], { cwd: repoPath });
    await wiring.sessionManager.initialize();

    await expect(
      wiring.sessionManager.resume(branch.id),
    ).rejects.toThrow(SessionBrokenError);
  });
});

// ---------------------------------------------------------------------------
// SC-008: Batch cleanup with partial failure
// ---------------------------------------------------------------------------

describe("SC-008: Batch cleanup with partial failure", () => {
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

  it("soft-deletes all 3 branches even when one worktree directory is already missing", async () => {
    const { wiring } = testWiring;

    // Create 3 TaskBranches via IPC events
    wiring.detector.handleIpcEvent({
      sessionId: "session-sc8-a",
      repoPath,
      filePath: "src/a.ts",
    });
    wiring.detector.handleIpcEvent({
      sessionId: "session-sc8-b",
      repoPath,
      filePath: "src/b.ts",
    });
    wiring.detector.handleIpcEvent({
      sessionId: "session-sc8-c",
      repoPath,
      filePath: "src/c.ts",
    });

    // Wait for all 3 to appear
    const [branchA, branchB, branchC] = await vi.waitFor(
      () => {
        const a = wiring.store.findBySessionId("session-sc8-a");
        const b = wiring.store.findBySessionId("session-sc8-b");
        const c = wiring.store.findBySessionId("session-sc8-c");
        if (a === undefined || b === undefined || c === undefined) {
          throw new Error("not all branches created yet");
        }
        return [a, b, c] as const;
      },
      { timeout: 10000 },
    );

    // Make all 3 stale (15 days old)
    const staleTime = Date.now() - 15 * 24 * 60 * 60 * 1000;
    wiring.store.updateActivity({ taskBranchId: branchA.id, lastActivityAt: staleTime });
    wiring.store.updateActivity({ taskBranchId: branchB.id, lastActivityAt: staleTime });
    wiring.store.updateActivity({ taskBranchId: branchC.id, lastActivityAt: staleTime });
    wiring.store.applyStaleThreshold(Date.now() - 14 * 24 * 60 * 60 * 1000);

    // Simulate prior partial cleanup: delete B's worktree dir from disk
    rmSync(branchB.worktreePath, { recursive: true, force: true });

    // Delete all 3 — removeWorktree is idempotent (silently ignores errors)
    // and softDelete succeeds regardless of worktree state
    await wiring.sessionManager.delete(branchA.id, { force: true });
    await wiring.sessionManager.delete(branchB.id, { force: true });
    await wiring.sessionManager.delete(branchC.id, { force: true });

    // All 3 records are soft-deleted
    expect(wiring.store.listAll().length).toBe(0);
    expect(wiring.store.findById(branchA.id)).toBeUndefined();
    expect(wiring.store.findById(branchB.id)).toBeUndefined();
    expect(wiring.store.findById(branchC.id)).toBeUndefined();
  });
});
