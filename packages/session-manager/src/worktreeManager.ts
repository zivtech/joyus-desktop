import { join } from "node:path";

import type { ExecGit } from "./taskBranchStore";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WorktreeCreateParams {
  readonly repoPath: string;
  readonly missionSlug: string;
  readonly sessionDate: string;
}

export interface WorktreeCreateResult {
  readonly worktreePath: string;
  readonly branchName: string;
}

export interface WorktreeManager {
  createWorktree(params: WorktreeCreateParams): Promise<WorktreeCreateResult>;
  removeWorktree(worktreePath: string): Promise<void>;
  isWorktreeHealthy(worktreePath: string, repoPath: string): Promise<boolean>;
  listWorktrees(repoPath: string): Promise<readonly string[]>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_COLLISION_RETRIES = 10;

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createWorktreeManager(execGit: ExecGit): WorktreeManager {
  return {
    async createWorktree(
      params: WorktreeCreateParams,
    ): Promise<WorktreeCreateResult> {
      const { repoPath, missionSlug, sessionDate } = params;

      let lastError: unknown;

      for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
        const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
        const baseName = `${sessionDate}-${missionSlug}${suffix}`;
        const branchName = `joyus/${baseName}`;
        const worktreePath = join(repoPath, ".joyus-worktrees", baseName);

        try {
          await execGit(
            ["worktree", "add", "-b", branchName, worktreePath],
            repoPath,
          );
          return { worktreePath, branchName };
        } catch (err: unknown) {
          lastError = err;
          // Non-zero exit code — assume collision, retry with suffix
        }
      }

      throw lastError;
    },

    async removeWorktree(worktreePath: string): Promise<void> {
      try {
        await execGit(["worktree", "remove", "--force", worktreePath]);
      } catch {
        // If worktree doesn't exist, treat as success (idempotent)
      }
    },

    async isWorktreeHealthy(
      worktreePath: string,
      repoPath: string,
    ): Promise<boolean> {
      try {
        const { stdout } = await execGit(
          ["worktree", "list", "--porcelain"],
          repoPath,
        );
        return stdout.includes(`worktree ${worktreePath}`);
      } catch {
        return false;
      }
    },

    async listWorktrees(repoPath: string): Promise<readonly string[]> {
      try {
        const { stdout } = await execGit(
          ["worktree", "list", "--porcelain"],
          repoPath,
        );
        const paths: string[] = [];
        for (const line of stdout.split("\n")) {
          if (line.startsWith("worktree ")) {
            paths.push(line.slice("worktree ".length));
          }
        }
        return paths;
      } catch {
        return [];
      }
    },
  };
}
