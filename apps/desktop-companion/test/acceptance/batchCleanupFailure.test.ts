/**
 * T047 — SC-008: Batch Cleanup with Injected Mid-Batch Failure
 *
 * Verifies that batch cleanup handles partial failures gracefully:
 * - Part 1: Physical test — all 4 branches removed without crash
 * - Part 2: Injected failure — 3 succeed, 1 fails, state is consistent
 */
import { describe, it, expect, afterEach } from "vitest";
import { vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTestRepo,
  createTestWiring,
  cleanupWiring,
} from "../integration/helpers.js";
import type { TestWiring } from "../integration/helpers.js";
import {
  openTaskBranchStore,
  createSessionManager,
} from "@joyus/session-manager";
import type { WorktreeManager, FileModificationDetector } from "@joyus/session-manager";

// ── Part 1: Physical test — all 4 branches deleted without crash ──────────────

describe("SC-008 Part 1: Batch cleanup with real worktrees and external deletions", () => {
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
    "all 4 branches deleted without crash when D's worktree is externally removed",
    { timeout: 60_000 },
    async () => {
      const repo = await createTestRepo();
      cleanups.push(repo.cleanup);

      const testWiring = await createTestWiring({ pollIntervalMs: 60_000 });
      wirings.push(testWiring);
      const { wiring } = testWiring;

      // Create 4 TaskBranches: A, B, C, D
      for (const sessionId of ["sc008-A", "sc008-B", "sc008-C", "sc008-D"]) {
        wiring.detector.handleIpcEvent({
          sessionId,
          repoPath: repo.repoPath,
          filePath: `src/${sessionId}.ts`,
        });
      }

      // Wait for all 4 to be created
      await vi.waitFor(
        () => {
          if (wiring.store.listAll().length < 4) throw new Error("not yet");
        },
        { timeout: 30_000 },
      );

      const branches = wiring.store.listAll();
      expect(branches).toHaveLength(4);

      const branchD = branches.find((b) => b.sessionId === "sc008-D")!;
      expect(branchD).toBeDefined();

      // Simulate external deletion of D's worktree before the batch runs
      rmSync(branchD.worktreePath, { recursive: true, force: true });
      const { execFile: execFileCb } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFile = promisify(execFileCb);
      await execFile("git", ["worktree", "prune"], { cwd: repo.repoPath });

      // Batch delete all 4 in order (force=true to skip uncommitted-changes check)
      let removed = 0;
      const failed: Array<{ id: string; reason: string }> = [];

      for (const branch of branches) {
        try {
          await wiring.sessionManager.delete(branch.id, { force: true });
          removed++;
        } catch (err) {
          failed.push({ id: branch.id, reason: err instanceof Error ? err.message : String(err) });
        }
      }

      // All 4 branches handled without exception propagating to the batch loop
      expect(removed + failed.length).toBe(4);

      // All 4 soft-deleted (removeWorktree is idempotent for missing paths)
      expect(removed).toBe(4);
      expect(failed).toHaveLength(0);
      expect(wiring.store.listAll()).toHaveLength(0);
    },
  );
});

// ── Part 2: Injected failure — mock WorktreeManager throws for branch C ───────

describe("SC-008 Part 2: Batch cleanup with injected mid-batch failure", () => {
  let dbDirs: string[] = [];

  afterEach(() => {
    for (const dir of dbDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    dbDirs = [];
  });

  it("3 branches succeed, 1 fails with structured error, store state is consistent", async () => {
    const dbDir = realpathSync(mkdtempSync(join(tmpdir(), "joyus-sc008-")));
    dbDirs.push(dbDir);
    const dbPath = join(dbDir, "test.db");

    // Worktree paths (fake — all operations go through the mock)
    const worktreePaths = {
      A: "/mock/worktree/a",
      B: "/mock/worktree/b",
      C: "/mock/worktree/c",  // ← mock will throw for this path
      D: "/mock/worktree/d",
    };

    // Mock WorktreeManager: removeWorktree throws only for branch C's path
    const mockRemoveWorktree = vi.fn().mockImplementation(async (path: string) => {
      if (path === worktreePaths.C) {
        throw new Error("Permission denied");
      }
    });

    const mockWorktreeManager: WorktreeManager = {
      createWorktree: vi.fn().mockResolvedValue({ worktreePath: "/mock", branchName: "joyus/mock" }),
      removeWorktree: mockRemoveWorktree,
      isWorktreeHealthy: vi.fn().mockResolvedValue(true),
      listWorktrees: vi.fn().mockResolvedValue([]),
    };

    // Mock FileModificationDetector (SessionManager only calls onModification in constructor)
    const mockDetector: FileModificationDetector = {
      onModification: vi.fn(),
      handleIpcEvent: vi.fn(),
      startPolling: vi.fn(),
      stopPolling: vi.fn(),
    } as unknown as FileModificationDetector;

    // Real ExecGit stub (hasUncommittedChanges uses it; returns clean status)
    const fakeExecGit = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });

    const store = openTaskBranchStore(dbPath);

    const sessionManager = createSessionManager({
      store,
      worktreeManager: mockWorktreeManager,
      detector: mockDetector,
      execGit: fakeExecGit,
    });

    // Create 4 stale branches directly in the store
    const branchA = store.create({
      sessionId: "sc008p2-a",
      repoPath: "/mock/repo",
      worktreePath: worktreePaths.A,
      branchName: "joyus/a",
      missionLabel: "Task A",
      missionSource: "inferred",
      mode: "managed",
    });
    const branchB = store.create({
      sessionId: "sc008p2-b",
      repoPath: "/mock/repo",
      worktreePath: worktreePaths.B,
      branchName: "joyus/b",
      missionLabel: "Task B",
      missionSource: "inferred",
      mode: "managed",
    });
    const branchC = store.create({
      sessionId: "sc008p2-c",
      repoPath: "/mock/repo",
      worktreePath: worktreePaths.C,
      branchName: "joyus/c",
      missionLabel: "Task C",
      missionSource: "inferred",
      mode: "managed",
    });
    const branchD = store.create({
      sessionId: "sc008p2-d",
      repoPath: "/mock/repo",
      worktreePath: worktreePaths.D,
      branchName: "joyus/d",
      missionLabel: "Task D",
      missionSource: "inferred",
      mode: "managed",
    });

    // Batch delete: mirrors the loop in Sessions.tsx handleBatchCleanup
    let removed = 0;
    const failed: Array<{ label: string; reason: string }> = [];

    for (const branch of [branchA, branchB, branchC, branchD]) {
      try {
        await sessionManager.delete(branch.id, { force: true });
        removed++;
      } catch (err) {
        failed.push({
          label: branch.missionLabel,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // A, B, D succeed; C fails
    expect(removed).toBe(3);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.label).toBe("Task C");
    expect(failed[0]!.reason).toContain("Permission denied");

    // No exception propagated to the batch loop caller
    expect(removed + failed.length).toBe(4);

    // A, B, D soft-deleted (not in store); C still present with original status
    expect(store.findById(branchA.id)).toBeUndefined();
    expect(store.findById(branchB.id)).toBeUndefined();
    expect(store.findById(branchC.id)).toBeDefined();  // NOT deleted
    expect(store.findById(branchD.id)).toBeUndefined();

    // store.listAll() reflects the final state: only C remains
    expect(store.listAll()).toHaveLength(1);
    expect(store.listAll()[0]!.id).toBe(branchC.id);

    store.close();
  });
});
