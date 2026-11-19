import { realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

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

export interface WorktreeRemoveOptions {
  /** Pass `--force` to git: remove even with modified or untracked files. */
  readonly force: boolean;
}

/** Resolves symbolic links in a path that exists; rejects when it does not. */
export type ResolveRealPath = (path: string) => Promise<string>;

export interface WorktreeManager {
  createWorktree(params: WorktreeCreateParams): Promise<WorktreeCreateResult>;
  /**
   * Removes the worktree, running git inside `repoPath`. Resolves when the
   * worktree is gone, including when it was gone already. Rejects with git's
   * error when the worktree is still registered, or when that cannot be checked.
   */
  removeWorktree(
    worktreePath: string,
    repoPath: string,
    opts: WorktreeRemoveOptions,
  ): Promise<void>;
  isWorktreeHealthy(worktreePath: string, repoPath: string): Promise<boolean>;
  listWorktrees(repoPath: string): Promise<readonly string[]>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_COLLISION_RETRIES = 10;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * `path` with symbolic links resolved, the way git prints worktree paths
 * (`/private/tmp/x` for `/tmp/x` on macOS). The trailing parts that no longer
 * exist are kept as given, so a removed worktree still gets a comparable path.
 */
async function resolveLikeGit(
  path: string,
  resolveRealPath: ResolveRealPath,
): Promise<string> {
  let existing = path;
  let missing = "";

  for (;;) {
    try {
      return join(await resolveRealPath(existing), missing);
    } catch {
      const parent = dirname(existing);
      if (parent === existing) {
        // Not even the root resolves: compare the path as given.
        return path;
      }
      missing = join(basename(existing), missing);
      existing = parent;
    }
  }
}

function parseWorktreePaths(porcelain: string): string[] {
  const paths: string[] = [];
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      paths.push(line.slice("worktree ".length));
    }
  }
  return paths;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createWorktreeManager(
  execGit: ExecGit,
  resolveRealPath: ResolveRealPath = realpath,
): WorktreeManager {
  /** Unlike `listWorktrees`, this rejects when git fails. */
  async function listWorktreesStrict(repoPath: string): Promise<string[]> {
    const { stdout } = await execGit(
      ["worktree", "list", "--porcelain"],
      repoPath,
    );
    return parseWorktreePaths(stdout);
  }

  async function isStillRegistered(
    worktreePath: string,
    repoPath: string,
  ): Promise<boolean> {
    // Git ran inside `repoPath`, so a relative worktree path means what git
    // took it to mean: relative to the repository, not to this process.
    const wanted = await resolveLikeGit(
      resolve(repoPath, worktreePath),
      resolveRealPath,
    );
    for (const listed of await listWorktreesStrict(repoPath)) {
      if ((await resolveLikeGit(listed, resolveRealPath)) === wanted) {
        return true;
      }
    }
    return false;
  }

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

    async removeWorktree(
      worktreePath: string,
      repoPath: string,
      opts: WorktreeRemoveOptions,
    ): Promise<void> {
      // A session whose worktree was never created has nothing to remove.
      if (worktreePath === "") {
        return;
      }

      const args = opts.force
        ? ["worktree", "remove", "--force", worktreePath]
        : ["worktree", "remove", worktreePath];

      try {
        await execGit(args, repoPath);
      } catch (error: unknown) {
        // Already gone counts as success, but only if git says so. If git
        // still lists the worktree, or cannot be asked, the removal failed
        // and the caller must know.
        let registered: boolean;
        try {
          registered = await isStillRegistered(worktreePath, repoPath);
        } catch {
          throw error;
        }
        if (registered) {
          throw error;
        }
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
        return await listWorktreesStrict(repoPath);
      } catch {
        return [];
      }
    },
  };
}
