import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileModificationDetector } from "../src/fileModificationDetector.js";
import {
  SessionBrokenError,
  SessionManager,
  SessionNotFoundError,
  UncommittedChangesError,
  createSessionManager,
} from "../src/sessionManager.js";
import type {
  TaskBranch,
  TaskBranchStore,
} from "../src/taskBranchStore.js";
import type { WorktreeManager } from "../src/worktreeManager.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBranch(overrides: Partial<TaskBranch> = {}): TaskBranch {
  return {
    id: "branch-1",
    sessionId: "sess-1",
    repoPath: "/repo",
    worktreePath: "/repo/.joyus-worktrees/2026-03-19-session",
    branchName: "joyus/2026-03-19-session",
    missionLabel: "2026-03-19-session",
    missionSource: "inferred",
    mode: "managed",
    status: "active",
    createdAt: 1000,
    lastActivityAt: 1000,
    ...overrides,
  };
}

function makeStore(
  overrides: Partial<TaskBranchStore> = {},
): TaskBranchStore {
  return {
    create: vi.fn().mockReturnValue(makeBranch()),
    findById: vi.fn().mockReturnValue(undefined),
    findBySessionId: vi.fn().mockReturnValue(undefined),
    listAll: vi.fn().mockReturnValue([]),
    updateStatus: vi.fn(),
    updateActivity: vi.fn(),
    softDelete: vi.fn(),
    applyStaleThreshold: vi.fn(),
    detectMerged: vi.fn().mockResolvedValue(undefined),
    scanIntegrity: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    ...overrides,
  };
}

function makeWorktreeManager(
  overrides: Partial<WorktreeManager> = {},
): WorktreeManager {
  return {
    createWorktree: vi.fn().mockResolvedValue({
      worktreePath: "/repo/.joyus-worktrees/2026-03-19-session",
      branchName: "joyus/2026-03-19-session",
    }),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    isWorktreeHealthy: vi.fn().mockResolvedValue(true),
    listWorktrees: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeExecGit(stdout = "") {
  return vi.fn().mockResolvedValue({ stdout, stderr: "" });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SessionManager", () => {
  // ─── onFileModification — advisory mode ────────────────────────────────

  describe("onFileModification — advisory mode", () => {
    it("does nothing in advisory mode (no store lookup, no worktree)", async () => {
      const store = makeStore();
      const worktreeManager = makeWorktreeManager();
      const execGit = makeExecGit();
      const detector = new FileModificationDetector(execGit, 10_000);
      const manager = new SessionManager(store, worktreeManager, detector, execGit);
      manager.setMode("advisory");

      await manager.onFileModification({
        sessionId: "sess-1",
        repoPath: "/repo",
        filePath: "/repo/src/foo.ts",
        detectedAt: Date.now(),
        source: "hook",
      });

      expect(store.findBySessionId).not.toHaveBeenCalled();
      expect(store.create).not.toHaveBeenCalled();
      expect(worktreeManager.createWorktree).not.toHaveBeenCalled();
    });

    it("advisory mode is repo-specific — managed global still creates for other repos", async () => {
      const store = makeStore();
      const worktreeManager = makeWorktreeManager();
      const execGit = makeExecGit();
      const detector = new FileModificationDetector(execGit, 10_000);
      const manager = new SessionManager(store, worktreeManager, detector, execGit);
      manager.setMode("advisory", "/repo-advisory");

      await manager.onFileModification({
        sessionId: "sess-2",
        repoPath: "/repo-managed",
        filePath: "/repo-managed/src/foo.ts",
        detectedAt: Date.now(),
        source: "hook",
      });

      expect(store.create).toHaveBeenCalled();
    });
  });

  // ─── onFileModification — managed mode ─────────────────────────────────

  describe("onFileModification — managed mode", () => {
    it("first event creates a TaskBranch and starts polling", async () => {
      const store = makeStore();
      const worktreeManager = makeWorktreeManager();
      const execGit = makeExecGit();
      const detector = new FileModificationDetector(execGit, 10_000);
      const startPollingSpy = vi.spyOn(detector, "startPolling");
      const manager = new SessionManager(store, worktreeManager, detector, execGit);

      await manager.onFileModification({
        sessionId: "sess-1",
        repoPath: "/repo",
        filePath: "/repo/src/foo.ts",
        detectedAt: Date.now(),
        source: "hook",
      });

      expect(store.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "sess-1",
          repoPath: "/repo",
          missionSource: "inferred",
          mode: "managed",
        }),
      );
      expect(startPollingSpy).toHaveBeenCalledWith("/repo", "sess-1");
    });

    it("second event for same session calls updateActivity only", async () => {
      const branch = makeBranch();
      const store = makeStore({
        findBySessionId: vi.fn().mockReturnValue(branch),
      });
      const worktreeManager = makeWorktreeManager();
      const execGit = makeExecGit();
      const detector = new FileModificationDetector(execGit, 10_000);
      const manager = new SessionManager(store, worktreeManager, detector, execGit);

      await manager.onFileModification({
        sessionId: "sess-1",
        repoPath: "/repo",
        filePath: "/repo/src/foo.ts",
        detectedAt: Date.now(),
        source: "hook",
      });

      expect(store.updateActivity).toHaveBeenCalledWith(
        expect.objectContaining({ taskBranchId: branch.id }),
      );
      expect(store.create).not.toHaveBeenCalled();
      expect(worktreeManager.createWorktree).not.toHaveBeenCalled();
    });

    it("worktree creation failure creates broken record, does not throw", async () => {
      // findBySessionId returns undefined (no existing session) so we go through create path
      const brokenBranch = makeBranch({ status: "active" });
      const store = makeStore({
        findBySessionId: vi.fn()
          .mockReturnValueOnce(undefined)   // first call: no existing session
          .mockReturnValueOnce(brokenBranch), // second call: after create, for status update
        create: vi.fn().mockReturnValue(brokenBranch),
      });
      const worktreeManager = makeWorktreeManager({
        createWorktree: vi.fn().mockRejectedValue(new Error("git error")),
      });

      const execGit = makeExecGit();
      const detector = new FileModificationDetector(execGit, 10_000);
      const manager = new SessionManager(store, worktreeManager, detector, execGit);

      await expect(
        manager.onFileModification({
          sessionId: "sess-1",
          repoPath: "/repo",
          filePath: "/repo/src/foo.ts",
          detectedAt: Date.now(),
          source: "hook",
        }),
      ).resolves.not.toThrow();

      expect(store.create).toHaveBeenCalled();
      expect(store.updateStatus).toHaveBeenCalledWith(brokenBranch.id, "broken");
    });
  });

  // ─── resume ────────────────────────────────────────────────────────────

  describe("resume", () => {
    it("throws SessionNotFoundError for unknown id", async () => {
      const store = makeStore({ findById: vi.fn().mockReturnValue(undefined) });
      const detector = new FileModificationDetector(makeExecGit(), 10_000);
      const manager = new SessionManager(store, makeWorktreeManager(), detector, makeExecGit());

      await expect(manager.resume("missing-id")).rejects.toThrow(
        SessionNotFoundError,
      );
    });

    it("throws SessionBrokenError and updates status when worktree unhealthy", async () => {
      const branch = makeBranch();
      const store = makeStore({ findById: vi.fn().mockReturnValue(branch) });
      const worktreeManager = makeWorktreeManager({
        isWorktreeHealthy: vi.fn().mockResolvedValue(false),
      });
      const detector = new FileModificationDetector(makeExecGit(), 10_000);
      const manager = new SessionManager(store, worktreeManager, detector, makeExecGit());

      await expect(manager.resume(branch.id)).rejects.toThrow(
        SessionBrokenError,
      );
      expect(store.updateStatus).toHaveBeenCalledWith(branch.id, "broken");
    });

    it("returns updated branch on healthy worktree resume", async () => {
      const branch = makeBranch();
      const updatedBranch = makeBranch({ status: "active" });
      const store = makeStore({
        findById: vi.fn()
          .mockReturnValueOnce(branch)
          .mockReturnValueOnce(updatedBranch),
      });
      const detector = new FileModificationDetector(makeExecGit(), 10_000);
      const manager = new SessionManager(store, makeWorktreeManager(), detector, makeExecGit());

      const result = await manager.resume(branch.id);

      expect(store.updateStatus).toHaveBeenCalledWith(branch.id, "active");
      expect(result).toBe(updatedBranch);
    });

    it("restarts polling on successful resume", async () => {
      const branch = makeBranch();
      const store = makeStore({
        findById: vi.fn().mockReturnValue(branch),
      });
      const execGit = makeExecGit();
      const detector = new FileModificationDetector(execGit, 10_000);
      const stopPollingSpy = vi.spyOn(detector, "stopPolling");
      const startPollingSpy = vi.spyOn(detector, "startPolling");
      const manager = new SessionManager(store, makeWorktreeManager(), detector, execGit);

      await manager.resume(branch.id);

      expect(stopPollingSpy).toHaveBeenCalledWith(branch.sessionId);
      expect(startPollingSpy).toHaveBeenCalledWith(branch.repoPath, branch.sessionId);
    });
  });

  // ─── delete ────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("throws SessionNotFoundError for unknown id", async () => {
      const store = makeStore({ findById: vi.fn().mockReturnValue(undefined) });
      const detector = new FileModificationDetector(makeExecGit(), 10_000);
      const manager = new SessionManager(store, makeWorktreeManager(), detector, makeExecGit());

      await expect(manager.delete("missing-id", { force: false })).rejects.toThrow(
        SessionNotFoundError,
      );
    });

    it("throws UncommittedChangesError when not forced and changes exist", async () => {
      const branch = makeBranch();
      const store = makeStore({ findById: vi.fn().mockReturnValue(branch) });
      const execGit = makeExecGit("M file.ts");
      const detector = new FileModificationDetector(execGit, 10_000);
      const manager = new SessionManager(store, makeWorktreeManager(), detector, execGit);

      await expect(manager.delete(branch.id, { force: false })).rejects.toThrow(
        UncommittedChangesError,
      );
    });

    it("force:true proceeds even with uncommitted changes", async () => {
      const branch = makeBranch();
      const store = makeStore({ findById: vi.fn().mockReturnValue(branch) });
      const execGit = makeExecGit("M file.ts");
      const worktreeManager = makeWorktreeManager();
      const detector = new FileModificationDetector(execGit, 10_000);
      const manager = new SessionManager(store, worktreeManager, detector, execGit);

      await expect(
        manager.delete(branch.id, { force: true }),
      ).resolves.not.toThrow();

      expect(worktreeManager.removeWorktree).toHaveBeenCalledWith(branch.worktreePath);
      expect(store.softDelete).toHaveBeenCalledWith(branch.id);
    });

    it("stops polling after successful delete", async () => {
      const branch = makeBranch();
      const store = makeStore({ findById: vi.fn().mockReturnValue(branch) });
      const execGit = makeExecGit();
      const detector = new FileModificationDetector(execGit, 10_000);
      const stopPollingSpy = vi.spyOn(detector, "stopPolling");
      const manager = new SessionManager(store, makeWorktreeManager(), detector, execGit);

      await manager.delete(branch.id, { force: true });

      expect(stopPollingSpy).toHaveBeenCalledWith(branch.sessionId);
    });
  });

  // ─── hasUncommittedChanges ──────────────────────────────────────────────

  describe("hasUncommittedChanges", () => {
    it("returns true when stdout is non-empty", async () => {
      const branch = makeBranch();
      const store = makeStore({ findById: vi.fn().mockReturnValue(branch) });
      const execGit = makeExecGit("M file.ts");
      const detector = new FileModificationDetector(execGit, 10_000);
      const manager = new SessionManager(store, makeWorktreeManager(), detector, execGit);

      expect(await manager.hasUncommittedChanges(branch.id)).toBe(true);
    });

    it("returns false when stdout is empty", async () => {
      const branch = makeBranch();
      const store = makeStore({ findById: vi.fn().mockReturnValue(branch) });
      const execGit = makeExecGit("");
      const detector = new FileModificationDetector(execGit, 10_000);
      const manager = new SessionManager(store, makeWorktreeManager(), detector, execGit);

      expect(await manager.hasUncommittedChanges(branch.id)).toBe(false);
    });

    it("returns false when branch not found", async () => {
      const store = makeStore({ findById: vi.fn().mockReturnValue(undefined) });
      const execGit = makeExecGit("M file.ts");
      const detector = new FileModificationDetector(execGit, 10_000);
      const manager = new SessionManager(store, makeWorktreeManager(), detector, execGit);

      expect(await manager.hasUncommittedChanges("missing")).toBe(false);
    });
  });

  // ─── initialize ────────────────────────────────────────────────────────

  describe("initialize", () => {
    it("calls scanIntegrity, applyStaleThreshold, detectMerged", async () => {
      const store = makeStore();
      const execGit = makeExecGit();
      const detector = new FileModificationDetector(execGit, 10_000);
      const manager = new SessionManager(store, makeWorktreeManager(), detector, execGit, 14);

      await manager.initialize();

      expect(store.scanIntegrity).toHaveBeenCalledWith(execGit);
      expect(store.applyStaleThreshold).toHaveBeenCalledWith(expect.any(Number));
      expect(store.detectMerged).toHaveBeenCalledWith(execGit);
    });

    it("applyStaleThreshold uses staleDays param", async () => {
      const store = makeStore();
      const execGit = makeExecGit();
      const detector = new FileModificationDetector(execGit, 10_000);
      const manager = new SessionManager(store, makeWorktreeManager(), detector, execGit, 7);

      const before = Date.now();
      await manager.initialize();
      const after = Date.now();

      const callArg = (store.applyStaleThreshold as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as number;
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(callArg).toBeLessThanOrEqual(before - sevenDaysMs + 100);
      expect(callArg).toBeGreaterThanOrEqual(after - sevenDaysMs - 100);
    });
  });

  // ─── getMode / setMode ─────────────────────────────────────────────────

  describe("getMode / setMode", () => {
    it("global mode defaults to managed", () => {
      const store = makeStore();
      const detector = new FileModificationDetector(makeExecGit(), 10_000);
      const manager = new SessionManager(store, makeWorktreeManager(), detector, makeExecGit());

      expect(manager.getMode()).toBe("managed");
    });

    it("setMode without repoPath sets global mode", () => {
      const store = makeStore();
      const detector = new FileModificationDetector(makeExecGit(), 10_000);
      const manager = new SessionManager(store, makeWorktreeManager(), detector, makeExecGit());

      manager.setMode("advisory");
      expect(manager.getMode()).toBe("advisory");
    });

    it("repo-level mode overrides global", () => {
      const store = makeStore();
      const detector = new FileModificationDetector(makeExecGit(), 10_000);
      const manager = new SessionManager(store, makeWorktreeManager(), detector, makeExecGit());

      manager.setMode("advisory", "/repo-a");
      expect(manager.getMode("/repo-a")).toBe("advisory");
      expect(manager.getMode("/repo-b")).toBe("managed");
      expect(manager.getMode()).toBe("managed");
    });

    it("getMode for unknown repo falls back to global", () => {
      const store = makeStore();
      const detector = new FileModificationDetector(makeExecGit(), 10_000);
      const manager = new SessionManager(store, makeWorktreeManager(), detector, makeExecGit());

      manager.setMode("advisory");
      expect(manager.getMode("/unknown-repo")).toBe("advisory");
    });
  });

  // ─── detector listener registration ───────────────────────────────────

  describe("detector listener registration", () => {
    it("constructor registers onModification listener that calls onFileModification", async () => {
      const store = makeStore();
      const execGit = makeExecGit();
      const detector = new FileModificationDetector(execGit, 10_000);
      const manager = new SessionManager(store, makeWorktreeManager(), detector, execGit);
      const onFileModSpy = vi.spyOn(manager, "onFileModification");

      detector.handleIpcEvent({
        sessionId: "sess-x",
        repoPath: "/repo",
        filePath: "/repo/x.ts",
      });

      // Allow microtasks to flush
      await Promise.resolve();

      expect(onFileModSpy).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "sess-x", source: "hook" }),
      );
    });
  });
});

describe("createSessionManager", () => {
  it("returns a SessionManager instance with correct initial mode", () => {
    const store = makeStore();
    const worktreeManager = makeWorktreeManager();
    const execGit = makeExecGit();
    const detector = new FileModificationDetector(execGit, 10_000);

    const manager = createSessionManager({ store, worktreeManager, detector, execGit });

    expect(manager).toBeInstanceOf(SessionManager);
    expect(manager.getMode()).toBe("managed");
  });

  it("passes staleDays through to the manager", async () => {
    const store = makeStore();
    const execGit = makeExecGit();
    const detector = new FileModificationDetector(execGit, 10_000);
    const manager = createSessionManager({
      store,
      worktreeManager: makeWorktreeManager(),
      detector,
      execGit,
      staleDays: 3,
    });

    const before = Date.now();
    await manager.initialize();
    const after = Date.now();

    const callArg = (store.applyStaleThreshold as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as number;
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    expect(callArg).toBeLessThanOrEqual(before - threeDaysMs + 100);
    expect(callArg).toBeGreaterThanOrEqual(after - threeDaysMs - 100);
  });
});
