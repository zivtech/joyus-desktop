import { join, resolve } from "node:path";
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
  const LISTING = "worktree /repo\nHEAD abc123\nbranch refs/heads/main\n\n";

  it("runs git worktree remove --force inside the repository when forced", async () => {
    const execGit: ExecGit = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });

    const mgr = createWorktreeManager(execGit);
    await mgr.removeWorktree("/repo/.joyus-worktrees/test", "/repo", { force: true });

    expect(execGit).toHaveBeenCalledOnce();
    expect(execGit).toHaveBeenCalledWith(
      ["worktree", "remove", "--force", "/repo/.joyus-worktrees/test"],
      "/repo",
    );
  });

  it("leaves --force out when not forced", async () => {
    const execGit: ExecGit = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });

    const mgr = createWorktreeManager(execGit);
    await mgr.removeWorktree("/repo/.joyus-worktrees/test", "/repo", { force: false });

    expect(execGit).toHaveBeenCalledWith(
      ["worktree", "remove", "/repo/.joyus-worktrees/test"],
      "/repo",
    );
  });

  it("does not call git for a session that never had a worktree", async () => {
    const execGit: ExecGit = vi.fn();

    const mgr = createWorktreeManager(execGit);
    await mgr.removeWorktree("", "/repo", { force: true });

    expect(execGit).not.toHaveBeenCalled();
  });

  it("does not throw when the worktree is already gone", async () => {
    const execGit: ExecGit = vi
      .fn()
      .mockRejectedValueOnce(new Error("is not a working tree"))
      .mockResolvedValueOnce({ stdout: LISTING, stderr: "" });

    const mgr = createWorktreeManager(execGit);
    await expect(
      mgr.removeWorktree("/repo/.joyus-worktrees/missing", "/repo", { force: true }),
    ).resolves.toBeUndefined();
    expect(execGit).toHaveBeenNthCalledWith(2, ["worktree", "list", "--porcelain"], "/repo");
  });

  it("throws git's error when git still lists the worktree after a failed removal", async () => {
    const execGit: ExecGit = vi
      .fn()
      .mockRejectedValueOnce(new Error("contains modified or untracked files"))
      .mockResolvedValueOnce({
        stdout: `${LISTING}worktree /repo/.joyus-worktrees/stuck\nHEAD def456\n\n`,
        stderr: "",
      });

    const mgr = createWorktreeManager(execGit);
    await expect(
      mgr.removeWorktree("/repo/.joyus-worktrees/stuck", "/repo", { force: false }),
    ).rejects.toThrow("contains modified or untracked files");
  });

  it("throws the removal error when the listing fails too", async () => {
    const execGit: ExecGit = vi
      .fn()
      .mockRejectedValueOnce(new Error("remove failed"))
      .mockRejectedValueOnce(new Error("list failed"));

    const mgr = createWorktreeManager(execGit);
    await expect(
      mgr.removeWorktree("/repo/.joyus-worktrees/stuck", "/repo", { force: true }),
    ).rejects.toThrow("remove failed");
  });

  it("recognizes the worktree when git lists it under its resolved path", async () => {
    // The repository is reached through a link: /link -> /real. Git prints /real.
    const resolveRealPath = vi.fn(async (path: string) => {
      if (path === "/link" || path === "/real") {
        return "/real";
      }
      throw new Error("ENOENT");
    });
    const execGit: ExecGit = vi
      .fn()
      .mockRejectedValueOnce(new Error("locked"))
      .mockResolvedValueOnce({
        stdout: "worktree /real\n\nworktree /real/.joyus-worktrees/stuck\n\n",
        stderr: "",
      });

    const mgr = createWorktreeManager(execGit, resolveRealPath);
    await expect(
      mgr.removeWorktree("/link/.joyus-worktrees/stuck", "/link", { force: true }),
    ).rejects.toThrow("locked");
  });

  it("takes a relative worktree path as relative to the repository, as git does", async () => {
    // Git ran inside "repo", so for git this path is repo/repo/.joyus-worktrees/stuck.
    const listedPath = resolve("repo", "repo/.joyus-worktrees/stuck");
    const execGit: ExecGit = vi
      .fn()
      .mockRejectedValueOnce(new Error("contains modified or untracked files"))
      .mockResolvedValueOnce({
        stdout: `worktree ${resolve("repo")}\n\nworktree ${listedPath}\n\n`,
        stderr: "",
      });

    const mgr = createWorktreeManager(execGit);
    await expect(
      mgr.removeWorktree("repo/.joyus-worktrees/stuck", "repo", { force: false }),
    ).rejects.toThrow("contains modified or untracked files");
  });

  it("compares paths as given when nothing on the path can be resolved", async () => {
    const resolveRealPath = vi.fn().mockRejectedValue(new Error("EACCES"));
    const stillListed: ExecGit = vi
      .fn()
      .mockRejectedValueOnce(new Error("locked"))
      .mockResolvedValueOnce({ stdout: "worktree /repo/.joyus-worktrees/stuck\n", stderr: "" });
    const gone: ExecGit = vi
      .fn()
      .mockRejectedValueOnce(new Error("is not a working tree"))
      .mockResolvedValueOnce({ stdout: "worktree /repo\n", stderr: "" });

    await expect(
      createWorktreeManager(stillListed, resolveRealPath).removeWorktree(
        "/repo/.joyus-worktrees/stuck",
        "/repo",
        { force: true },
      ),
    ).rejects.toThrow("locked");
    await expect(
      createWorktreeManager(gone, resolveRealPath).removeWorktree(
        "/repo/.joyus-worktrees/stuck",
        "/repo",
        { force: true },
      ),
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
