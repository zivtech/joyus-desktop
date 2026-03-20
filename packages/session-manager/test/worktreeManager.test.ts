import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createWorktreeManager } from "../src/worktreeManager";
import type { ExecGit } from "../src/taskBranchStore";

describe("createWorktree", () => {
  it("returns correct branchName and worktreePath", async () => {
    const execGit: ExecGit = vi.fn().mockResolvedValue({
      stdout: "",
      stderr: "",
    });

    const mgr = createWorktreeManager(execGit);
    const result = await mgr.createWorktree({
      repoPath: "/repo",
      missionSlug: "update-homepage",
      sessionDate: "2026-03-19",
    });

    expect(result.branchName).toBe("joyus/2026-03-19-update-homepage");
    expect(result.worktreePath).toBe(
      join("/repo", ".joyus-worktrees", "2026-03-19-update-homepage"),
    );
    expect(execGit).toHaveBeenCalledWith(
      [
        "worktree",
        "add",
        "-b",
        "joyus/2026-03-19-update-homepage",
        result.worktreePath,
      ],
      "/repo",
    );
  });

  it("retries with suffix on collision", async () => {
    const execGit: ExecGit = vi
      .fn()
      .mockRejectedValueOnce(new Error("already exists"))
      .mockResolvedValueOnce({ stdout: "", stderr: "" });

    const mgr = createWorktreeManager(execGit);
    const result = await mgr.createWorktree({
      repoPath: "/repo",
      missionSlug: "feature",
      sessionDate: "2026-03-19",
    });

    expect(result.branchName).toBe("joyus/2026-03-19-feature-2");
    expect(result.worktreePath).toBe(
      join("/repo", ".joyus-worktrees", "2026-03-19-feature-2"),
    );
    expect(execGit).toHaveBeenCalledTimes(2);
  });

  it("throws after max retries exhausted", async () => {
    const execGit: ExecGit = vi
      .fn()
      .mockRejectedValue(new Error("already exists"));

    const mgr = createWorktreeManager(execGit);
    await expect(
      mgr.createWorktree({
        repoPath: "/repo",
        missionSlug: "conflict",
        sessionDate: "2026-03-19",
      }),
    ).rejects.toThrow("already exists");

    expect(execGit).toHaveBeenCalledTimes(10);
  });
});

describe("removeWorktree", () => {
  it("calls git worktree remove --force", async () => {
    const execGit: ExecGit = vi.fn().mockResolvedValue({
      stdout: "",
      stderr: "",
    });

    const mgr = createWorktreeManager(execGit);
    await mgr.removeWorktree("/repo/.joyus-worktrees/test");

    expect(execGit).toHaveBeenCalledWith([
      "worktree",
      "remove",
      "--force",
      "/repo/.joyus-worktrees/test",
    ]);
  });

  it("does not throw when worktree is missing (idempotent)", async () => {
    const execGit: ExecGit = vi
      .fn()
      .mockRejectedValue(new Error("not a worktree"));

    const mgr = createWorktreeManager(execGit);
    await expect(
      mgr.removeWorktree("/repo/.joyus-worktrees/missing"),
    ).resolves.toBeUndefined();
  });
});

describe("isWorktreeHealthy", () => {
  it("returns true when worktree path appears in porcelain output", async () => {
    const execGit: ExecGit = vi.fn().mockResolvedValue({
      stdout:
        "worktree /repo\n\nworktree /repo/.joyus-worktrees/healthy\nbranch refs/heads/joyus/test\n\n",
      stderr: "",
    });

    const mgr = createWorktreeManager(execGit);
    const result = await mgr.isWorktreeHealthy(
      "/repo/.joyus-worktrees/healthy",
      "/repo",
    );
    expect(result).toBe(true);
  });

  it("returns false when worktree path is absent", async () => {
    const execGit: ExecGit = vi.fn().mockResolvedValue({
      stdout: "worktree /repo\n\n",
      stderr: "",
    });

    const mgr = createWorktreeManager(execGit);
    const result = await mgr.isWorktreeHealthy(
      "/repo/.joyus-worktrees/absent",
      "/repo",
    );
    expect(result).toBe(false);
  });

  it("returns false when execGit throws", async () => {
    const execGit: ExecGit = vi
      .fn()
      .mockRejectedValue(new Error("git error"));

    const mgr = createWorktreeManager(execGit);
    const result = await mgr.isWorktreeHealthy("/any-path", "/repo");
    expect(result).toBe(false);
  });
});

describe("listWorktrees", () => {
  it("parses porcelain output into paths", async () => {
    const execGit: ExecGit = vi.fn().mockResolvedValue({
      stdout:
        "worktree /repo\nHEAD abc123\nbranch refs/heads/main\n\nworktree /repo/.joyus-worktrees/feat\nHEAD def456\nbranch refs/heads/joyus/feat\n\n",
      stderr: "",
    });

    const mgr = createWorktreeManager(execGit);
    const result = await mgr.listWorktrees("/repo");

    expect(result).toEqual(["/repo", "/repo/.joyus-worktrees/feat"]);
  });

  it("returns empty array when execGit throws", async () => {
    const execGit: ExecGit = vi
      .fn()
      .mockRejectedValue(new Error("git error"));

    const mgr = createWorktreeManager(execGit);
    const result = await mgr.listWorktrees("/repo");
    expect(result).toEqual([]);
  });

  it("returns empty array for empty stdout", async () => {
    const execGit: ExecGit = vi.fn().mockResolvedValue({
      stdout: "",
      stderr: "",
    });

    const mgr = createWorktreeManager(execGit);
    const result = await mgr.listWorktrees("/repo");
    expect(result).toEqual([]);
  });
});
