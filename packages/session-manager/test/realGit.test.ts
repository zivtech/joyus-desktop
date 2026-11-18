import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileModificationDetector } from "../src/fileModificationDetector.js";
import { SessionManager } from "../src/sessionManager.js";
import { openTaskBranchStore } from "../src/taskBranchStore.js";
import type { ExecGit, TaskBranchStore } from "../src/taskBranchStore.js";
import { createWorktreeManager } from "../src/worktreeManager.js";

// These tests run the real git binary in throwaway repositories. Mocked git
// output cannot show what git really prints for a fast-forward, or how it
// spells a worktree path.

const execFileAsync = promisify(execFile);

let root: string;
let repo: string;
let execGit: ExecGit;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "session-manager-real-git-"));
  repo = join(root, "repo");
  await mkdir(repo);
  // An empty global config and a fixed identity: the developer's own git
  // settings (signing, hooks, default branch) must not reach these tests.
  const emptyConfig = join(root, "gitconfig");
  await writeFile(emptyConfig, "");
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.invalid",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.invalid",
  };
  execGit = async (args, cwd) => {
    const { stdout, stderr } = await execFileAsync("git", args, { cwd, env });
    return { stdout, stderr };
  };

  await execGit(["init", "-q"], repo);
  await execGit(["symbolic-ref", "HEAD", "refs/heads/main"], repo);
  await commitFile(repo, "base.txt", "base");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function commitFile(cwd: string, name: string, message: string): Promise<void> {
  await writeFile(join(cwd, name), `${message}\n`);
  await execGit(["add", name], cwd);
  await execGit(["commit", "-q", "-m", message], cwd);
}

/** A session branch in its own worktree, the way the worktree manager makes one. */
async function addSessionWorktree(name: string, repoPath = repo): Promise<string> {
  const worktreePath = join(repoPath, ".joyus-worktrees", name);
  await execGit(["worktree", "add", "-q", "-b", `joyus/${name}`, worktreePath], repoPath);
  return worktreePath;
}

describe("detectMerged against real git", () => {
  let store: TaskBranchStore;

  beforeEach(() => {
    store = openTaskBranchStore(join(root, "sessions.db"));
  });

  afterEach(() => {
    store.close();
  });

  function track(name: string, worktreePath: string): void {
    store.create({
      sessionId: `sess-${name}`,
      repoPath: repo,
      worktreePath,
      branchName: `joyus/${name}`,
      missionLabel: name,
      missionSource: "inferred",
      mode: "managed",
    });
  }

  function statusOf(name: string): string | undefined {
    return store.findBySessionId(`sess-${name}`)?.status;
  }

  it("does not mark a fresh session branch", async () => {
    track("fresh", await addSessionWorktree("fresh"));

    await store.detectMerged(execGit);

    expect(statusOf("fresh")).toBe("active");
  });

  it("does not mark a session branch that was only fast-forwarded to a newer main", async () => {
    const worktree = await addSessionWorktree("ff");
    track("ff", worktree);
    await commitFile(repo, "main-1.txt", "main moves on");
    await execGit(["merge", "-q", "main"], worktree);

    // Git lists it as merged, with the "+" of a branch checked out elsewhere.
    const { stdout } = await execGit(["branch", "--merged", "HEAD"], repo);
    expect(stdout).toContain("+ joyus/ff");

    await store.detectMerged(execGit);

    expect(statusOf("ff")).toBe("active");
  });

  it("marks a session branch whose commit was merged into main", async () => {
    const worktree = await addSessionWorktree("work");
    track("work", worktree);
    await commitFile(worktree, "work.txt", "session work");

    await store.detectMerged(execGit);
    expect(statusOf("work")).toBe("active");

    await commitFile(repo, "main-1.txt", "main moves on");
    await execGit(["merge", "-q", "--no-edit", "joyus/work"], repo);
    await store.detectMerged(execGit);

    expect(statusOf("work")).toBe("merged");
  });

  it("marks a session branch that was rebased and then fast-forwarded into main", async () => {
    const worktree = await addSessionWorktree("rebased");
    track("rebased", worktree);
    await commitFile(worktree, "work.txt", "session work");
    await commitFile(repo, "main-1.txt", "main moves on");
    await execGit(["rebase", "-q", "main"], worktree);
    await execGit(["merge", "-q", "--ff-only", "joyus/rebased"], repo);

    await store.detectMerged(execGit);

    expect(statusOf("rebased")).toBe("merged");
  });
});

describe("removeWorktree against real git", () => {
  async function listed(): Promise<string> {
    return (await execGit(["worktree", "list", "--porcelain"], repo)).stdout;
  }

  it("removes a clean worktree without force", async () => {
    const worktree = await addSessionWorktree("clean");

    await createWorktreeManager(execGit).removeWorktree(worktree, repo, { force: false });

    expect(existsSync(worktree)).toBe(false);
    expect(await listed()).not.toContain(".joyus-worktrees/clean");
  });

  it("refuses a worktree with an untracked file unless forced", async () => {
    const worktree = await addSessionWorktree("dirty");
    await writeFile(join(worktree, "new.txt"), "not committed\n");
    const manager = createWorktreeManager(execGit);

    await expect(manager.removeWorktree(worktree, repo, { force: false })).rejects.toThrow(
      "contains modified or untracked files",
    );
    expect(existsSync(join(worktree, "new.txt"))).toBe(true);

    await manager.removeWorktree(worktree, repo, { force: true });
    expect(existsSync(worktree)).toBe(false);
  });

  it("resolves when the worktree folder was deleted by hand, and again when nothing is left", async () => {
    const worktree = await addSessionWorktree("gone");
    await rm(worktree, { recursive: true, force: true });
    const manager = createWorktreeManager(execGit);

    await expect(manager.removeWorktree(worktree, repo, { force: true })).resolves.toBeUndefined();
    await expect(manager.removeWorktree(worktree, repo, { force: true })).resolves.toBeUndefined();
    expect(await listed()).not.toContain(".joyus-worktrees/gone");
  });

  it("still sees a refused worktree when the repository is reached through a symbolic link", async () => {
    // Git lists the resolved path; the session stored the path through the link.
    const link = join(root, "link");
    await symlink(repo, link);
    const worktree = await addSessionWorktree("linked", link);
    await writeFile(join(worktree, "new.txt"), "not committed\n");
    expect(await listed()).toContain(join(await realpath(repo), ".joyus-worktrees", "linked"));
    expect(await listed()).not.toContain(worktree);

    await expect(
      createWorktreeManager(execGit).removeWorktree(worktree, link, { force: false }),
    ).rejects.toThrow("contains modified or untracked files");
    expect(existsSync(worktree)).toBe(true);
  });

  it("still sees a refused worktree when the stored paths are relative", async () => {
    const previousCwd = process.cwd();
    process.chdir(root);
    try {
      // What the worktree manager stores when the repository path is relative.
      const worktree = join("repo", ".joyus-worktrees", "relative");
      await execGit(["worktree", "add", "-q", "-b", "joyus/relative", worktree], "repo");
      // Git ran inside the repository and took the path as relative to it.
      const actual = join(repo, "repo", ".joyus-worktrees", "relative");
      await writeFile(join(actual, "new.txt"), "not committed\n");

      await expect(
        createWorktreeManager(execGit).removeWorktree(worktree, "repo", { force: false }),
      ).rejects.toThrow("contains modified or untracked files");
      expect(existsSync(actual)).toBe(true);
    } finally {
      process.chdir(previousCwd);
    }
  });
});

describe("SessionManager.delete against real git", () => {
  it("deletes a session without force after its worktree folder was deleted by hand", async () => {
    const store = openTaskBranchStore(join(root, "sessions.db"));
    try {
      const worktree = await addSessionWorktree("handgone");
      const created = store.create({
        sessionId: "sess-handgone",
        repoPath: repo,
        worktreePath: worktree,
        branchName: "joyus/handgone",
        missionLabel: "handgone",
        missionSource: "inferred",
        mode: "managed",
      });
      const manager = new SessionManager(
        store,
        createWorktreeManager(execGit),
        new FileModificationDetector(execGit, 10_000),
        execGit,
      );
      await rm(worktree, { recursive: true, force: true });

      await manager.delete(created.id, { force: false });

      expect(store.findBySessionId("sess-handgone")).toBeUndefined();
      const { stdout } = await execGit(["worktree", "list", "--porcelain"], repo);
      expect(stdout).not.toContain(".joyus-worktrees/handgone");
    } finally {
      store.close();
    }
  });
});
