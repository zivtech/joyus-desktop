import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionCloser } from "../src/sessionCloser";
import type { SessionCloser } from "../src/sessionCloser";
import type { TaskBranch, TaskBranchStore } from "../src/taskBranchStore";
import type { GitPusher } from "../src/gitPusher";
import type { PrCreator } from "../src/prCreator";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBranch(overrides: Partial<TaskBranch> = {}): TaskBranch {
  return {
    id: "branch-1",
    sessionId: "sess-1",
    repoPath: "/repo",
    worktreePath: "/repo/.joyus-worktrees/2026-04-01",
    branchName: "joyus/2026-04-01-feature",
    missionLabel: "QA: review layout",
    missionSource: "inferred",
    mode: "managed",
    status: "active",
    createdAt: 1000,
    lastActivityAt: 1000,
    prNumber: undefined,
    prUrl: undefined,
    prTitle: undefined,
    ...overrides,
  };
}

function makeStore(overrides: Partial<TaskBranchStore> = {}): TaskBranchStore {
  return {
    create: vi.fn(),
    findById: vi.fn().mockReturnValue(makeBranch()),
    findBySessionId: vi.fn(),
    listAll: vi.fn().mockReturnValue([]),
    updateStatus: vi.fn(),
    updateActivity: vi.fn(),
    updatePrAssociation: vi.fn(),
    softDelete: vi.fn(),
    applyStaleThreshold: vi.fn(),
    detectMerged: vi.fn().mockResolvedValue(undefined),
    scanIntegrity: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    ...overrides,
  };
}

function makeGitPusher(overrides: Partial<GitPusher> = {}): GitPusher {
  return {
    push: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makePrCreator(overrides: Partial<PrCreator> = {}): PrCreator {
  return {
    createDraftPr: vi.fn().mockResolvedValue({
      prNumber: 42,
      prUrl: "https://github.com/zivtech/repo/pull/42",
      prTitle: "QA: review layout",
    }),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createSessionCloser", () => {
  let store: TaskBranchStore;
  let gitPusher: GitPusher;
  let prCreator: PrCreator;
  let execGit: ReturnType<typeof vi.fn>;
  let closer: SessionCloser;

  beforeEach(() => {
    store = makeStore();
    gitPusher = makeGitPusher();
    prCreator = makePrCreator();
    execGit = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    closer = createSessionCloser({ store, gitPusher, prCreator, execGit });
  });

  it("throws when TaskBranch is not found", async () => {
    store = makeStore({ findById: vi.fn().mockReturnValue(undefined) });
    closer = createSessionCloser({ store, gitPusher, prCreator, execGit });

    await expect(closer.close("missing-id")).rejects.toThrow(
      "TaskBranch not found: missing-id",
    );
  });

  it("returns pushed=false and no PR for advisory mode sessions", async () => {
    store = makeStore({
      findById: vi.fn().mockReturnValue(makeBranch({ mode: "advisory" })),
    });
    closer = createSessionCloser({ store, gitPusher, prCreator, execGit });

    const result = await closer.close("branch-1", { createPr: true });

    expect(result.pushed).toBe(false);
    expect(result.prNumber).toBeUndefined();
    expect(gitPusher.push).not.toHaveBeenCalled();
    expect(prCreator.createDraftPr).not.toHaveBeenCalled();
  });

  it("pushes but does not create PR when createPr=false", async () => {
    const result = await closer.close("branch-1", { createPr: false });

    expect(result.pushed).toBe(true);
    expect(gitPusher.push).toHaveBeenCalledWith("/repo", "joyus/2026-04-01-feature");
    expect(result.prNumber).toBeUndefined();
    expect(prCreator.createDraftPr).not.toHaveBeenCalled();
  });

  it("pushes by default with no options", async () => {
    const result = await closer.close("branch-1");

    expect(result.pushed).toBe(true);
    expect(gitPusher.push).toHaveBeenCalledWith("/repo", "joyus/2026-04-01-feature");
    expect(result.prNumber).toBeUndefined();
  });

  it("creates draft PR when createPr=true and updates store", async () => {
    const result = await closer.close("branch-1", { createPr: true });

    expect(result.pushed).toBe(true);
    expect(result.prNumber).toBe(42);
    expect(result.prUrl).toBe("https://github.com/zivtech/repo/pull/42");
    expect(result.prTitle).toBe("QA: review layout");

    expect(store.updatePrAssociation).toHaveBeenCalledWith({
      taskBranchId: "branch-1",
      prNumber: 42,
      prUrl: "https://github.com/zivtech/repo/pull/42",
      prTitle: "QA: review layout",
    });
  });

  it("reuses existing PR association instead of creating a duplicate draft PR", async () => {
    store = makeStore({
      findById: vi.fn().mockReturnValue(makeBranch({
        prNumber: 99,
        prUrl: "https://github.com/zivtech/repo/pull/99",
        prTitle: "Existing PR",
      })),
    });
    const onPrCreated = vi.fn().mockResolvedValue(undefined);
    closer = createSessionCloser({
      store,
      gitPusher,
      prCreator,
      execGit,
      onPrCreated,
    });

    const result = await closer.close("branch-1", { createPr: true });

    expect(result).toEqual({
      taskBranchId: "branch-1",
      branchName: "joyus/2026-04-01-feature",
      pushed: true,
      prNumber: 99,
      prUrl: "https://github.com/zivtech/repo/pull/99",
      prTitle: "Existing PR",
    });
    expect(gitPusher.push).toHaveBeenCalledWith("/repo", "joyus/2026-04-01-feature");
    expect(prCreator.createDraftPr).not.toHaveBeenCalled();
    expect(store.updatePrAssociation).not.toHaveBeenCalled();
    expect(onPrCreated).not.toHaveBeenCalled();
  });

  it("uses missionLabel as default PR title", async () => {
    await closer.close("branch-1", { createPr: true });

    expect(prCreator.createDraftPr).toHaveBeenCalledWith(
      "/repo",
      "joyus/2026-04-01-feature",
      "QA: review layout",
      undefined,
    );
  });

  it("uses provided prTitle when given", async () => {
    await closer.close("branch-1", {
      createPr: true,
      prTitle: "Custom Title",
      prBody: "Body text",
    });

    expect(prCreator.createDraftPr).toHaveBeenCalledWith(
      "/repo",
      "joyus/2026-04-01-feature",
      "Custom Title",
      "Body text",
    );
  });

  it("calls onPrCreated callback after PR creation", async () => {
    const onPrCreated = vi.fn().mockResolvedValue(undefined);
    closer = createSessionCloser({
      store,
      gitPusher,
      prCreator,
      execGit,
      onPrCreated,
    });

    await closer.close("branch-1", { createPr: true });

    expect(onPrCreated).toHaveBeenCalledWith(
      "/repo",
      "joyus/2026-04-01-feature",
      42,
      "branch-1",
    );
  });

  it("does not call onPrCreated when no PR is created", async () => {
    const onPrCreated = vi.fn().mockResolvedValue(undefined);
    closer = createSessionCloser({
      store,
      gitPusher,
      prCreator,
      execGit,
      onPrCreated,
    });

    await closer.close("branch-1", { createPr: false });

    expect(onPrCreated).not.toHaveBeenCalled();
  });

  describe("autoCommit", () => {
    it("does not commit when no uncommitted changes", async () => {
      execGit = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
      closer = createSessionCloser({ store, gitPusher, prCreator, execGit });

      await closer.close("branch-1", { autoCommit: true });

      // Only git status should have been called (not add/commit)
      expect(execGit).toHaveBeenCalledWith(
        ["status", "--porcelain"],
        "/repo/.joyus-worktrees/2026-04-01",
      );
      expect(execGit).not.toHaveBeenCalledWith(
        expect.arrayContaining(["commit"]),
        expect.anything(),
      );
    });

    it("stages and commits when uncommitted changes exist", async () => {
      execGit = vi.fn().mockImplementation(
        async (args: string[]) => {
          if (args[0] === "status") {
            return { stdout: " M modified-file.ts\n", stderr: "" };
          }
          return { stdout: "", stderr: "" };
        },
      );
      closer = createSessionCloser({ store, gitPusher, prCreator, execGit });

      await closer.close("branch-1", { autoCommit: true });

      expect(execGit).toHaveBeenCalledWith(
        ["add", "-A"],
        "/repo/.joyus-worktrees/2026-04-01",
      );
      expect(execGit).toHaveBeenCalledWith(
        ["commit", "-m", "WIP: QA: review layout"],
        "/repo/.joyus-worktrees/2026-04-01",
      );
    });

    it("does not run git status when autoCommit=false", async () => {
      execGit = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
      closer = createSessionCloser({ store, gitPusher, prCreator, execGit });

      await closer.close("branch-1", { autoCommit: false });

      expect(execGit).not.toHaveBeenCalled();
    });
  });
});
