import type { ExecGit, TaskBranchStore } from "./taskBranchStore.js";
import type { GitPusher } from "./gitPusher.js";
import type { PrCreator } from "./prCreator.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SessionCloseOptions {
  /** Stage all changes and commit with an auto-generated message. Default: false. */
  readonly autoCommit?: boolean;
  /** Create a draft PR after pushing. Only applies in managed mode. Default: false. */
  readonly createPr?: boolean;
  /** PR title. Defaults to the task branch missionLabel. */
  readonly prTitle?: string;
  /** Optional PR body. */
  readonly prBody?: string;
}

export interface SessionCloseResult {
  readonly taskBranchId: string;
  readonly branchName: string;
  readonly pushed: boolean;
  readonly prNumber: number | undefined;
  readonly prUrl: string | undefined;
  readonly prTitle: string | undefined;
}

export interface OnPrCreatedCallback {
  (
    repoPath: string,
    branchName: string,
    prNumber: number,
    taskBranchId: string,
  ): Promise<void>;
}

export interface SessionCloserDeps {
  readonly store: TaskBranchStore;
  readonly gitPusher: GitPusher;
  readonly prCreator: PrCreator;
  readonly execGit: ExecGit;
  /** Called after a PR is created — wire this to environmentMonitor.onPrCreated. */
  readonly onPrCreated?: OnPrCreatedCallback;
}

export interface SessionCloser {
  close(
    taskBranchId: string,
    opts?: SessionCloseOptions,
  ): Promise<SessionCloseResult>;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createSessionCloser(deps: SessionCloserDeps): SessionCloser {
  const { store, gitPusher, prCreator, execGit, onPrCreated } = deps;

  return {
    async close(
      taskBranchId: string,
      opts: SessionCloseOptions = {},
    ): Promise<SessionCloseResult> {
      const branch = store.findById(taskBranchId);
      if (branch === undefined) {
        throw new Error(`TaskBranch not found: ${taskBranchId}`);
      }

      const { autoCommit = false, createPr = false } = opts;
      const prTitle = opts.prTitle ?? branch.missionLabel;
      const prBody = opts.prBody;

      // Auto-commit uncommitted changes if requested
      if (autoCommit) {
        const { stdout: statusOut } = await execGit(
          ["status", "--porcelain"],
          branch.worktreePath,
        );
        if (statusOut.trim().length > 0) {
          await execGit(["add", "-A"], branch.worktreePath);
          await execGit(
            ["commit", "-m", `WIP: ${branch.missionLabel}`],
            branch.worktreePath,
          );
        }
      }

      // Only push and PR in managed mode
      if (branch.mode !== "managed") {
        return {
          taskBranchId,
          branchName: branch.branchName,
          pushed: false,
          prNumber: undefined,
          prUrl: undefined,
          prTitle: undefined,
        };
      }

      // Push branch to remote
      await gitPusher.push(branch.repoPath, branch.branchName);

      if (!createPr) {
        return {
          taskBranchId,
          branchName: branch.branchName,
          pushed: true,
          prNumber: undefined,
          prUrl: undefined,
          prTitle: undefined,
        };
      }

      // Create draft PR
      const result = await prCreator.createDraftPr(
        branch.repoPath,
        branch.branchName,
        prTitle,
        prBody,
      );

      // Persist PR association in store
      store.updatePrAssociation({
        taskBranchId,
        prNumber: result.prNumber,
        prUrl: result.prUrl,
        prTitle: result.prTitle,
      });

      // Notify cross-feature bridge
      if (onPrCreated !== undefined) {
        await onPrCreated(
          branch.repoPath,
          branch.branchName,
          result.prNumber,
          taskBranchId,
        );
      }

      return {
        taskBranchId,
        branchName: branch.branchName,
        pushed: true,
        prNumber: result.prNumber,
        prUrl: result.prUrl,
        prTitle: result.prTitle,
      };
    },
  };
}
