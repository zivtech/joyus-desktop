import type { ExecGit } from "./taskBranchStore.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GitPusher {
  /** Push a branch to a remote. Defaults to 'origin'. */
  push(repoPath: string, branchName: string, remote?: string): Promise<void>;
}

export interface GitPusherDeps {
  readonly execGit: ExecGit;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createGitPusher(deps: GitPusherDeps): GitPusher {
  const { execGit } = deps;

  return {
    async push(
      repoPath: string,
      branchName: string,
      remote = "origin",
    ): Promise<void> {
      await execGit(
        ["push", "-u", remote, branchName],
        repoPath,
      );
    },
  };
}
