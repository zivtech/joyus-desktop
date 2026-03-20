import { inferMissionLabel } from "./missionInferrer.js";
import type { ExecGit, TaskBranch, TaskBranchStore } from "./taskBranchStore.js";
import type { OperatingMode } from "./taskBranchStore.js";
import type { FileModificationDetector, FileModificationEvent } from "./fileModificationDetector.js";
import type { WorktreeManager } from "./worktreeManager.js";

// ─── Errors ───────────────────────────────────────────────────────────────────

export class SessionNotFoundError extends Error {
  constructor(readonly taskBranchId: string) {
    super(`Session not found: ${taskBranchId}`);
    this.name = "SessionNotFoundError";
  }
}

export class SessionBrokenError extends Error {
  constructor(readonly taskBranchId: string) {
    super(`Session worktree is broken: ${taskBranchId}`);
    this.name = "SessionBrokenError";
  }
}

export class UncommittedChangesError extends Error {
  constructor(readonly taskBranchId: string) {
    super(`Session has uncommitted changes: ${taskBranchId}`);
    this.name = "UncommittedChangesError";
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ─── SessionManager ───────────────────────────────────────────────────────────

export class SessionManager {
  private readonly repoModes = new Map<string, OperatingMode>();
  private globalMode: OperatingMode = "managed";

  constructor(
    private readonly store: TaskBranchStore,
    private readonly worktreeManager: WorktreeManager,
    private readonly detector: FileModificationDetector,
    private readonly execGit: ExecGit,
    private readonly staleDays: number = 14,
  ) {
    detector.onModification((event) => {
      void this.onFileModification(event);
    });
  }

  async onFileModification(event: FileModificationEvent): Promise<void> {
    if (this.getMode(event.repoPath) === "advisory") {
      return;
    }

    const existing = this.store.findBySessionId(event.sessionId);
    if (existing !== undefined) {
      this.store.updateActivity({
        taskBranchId: existing.id,
        lastActivityAt: Date.now(),
      });
      return;
    }

    const missionLabel = inferMissionLabel([event.filePath]);
    const missionSlug = missionLabel.replace(/^\d{4}-\d{2}-\d{2}-/, "");

    let worktreePath: string;
    let branchName: string;

    try {
      const result = await this.worktreeManager.createWorktree({
        repoPath: event.repoPath,
        missionSlug,
        sessionDate: todayString(),
      });
      worktreePath = result.worktreePath;
      branchName = result.branchName;
    } catch {
      this.store.create({
        sessionId: event.sessionId,
        repoPath: event.repoPath,
        worktreePath: "",
        branchName: "",
        missionLabel,
        missionSource: "inferred",
        mode: "managed",
      });
      // Update the broken record's status
      const broken = this.store.findBySessionId(event.sessionId);
      if (broken !== undefined) {
        this.store.updateStatus(broken.id, "broken");
      }
      return;
    }

    const branch = this.store.create({
      sessionId: event.sessionId,
      repoPath: event.repoPath,
      worktreePath,
      branchName,
      missionLabel,
      missionSource: "inferred",
      mode: "managed",
    });

    this.detector.startPolling(event.repoPath, event.sessionId);

    // Suppress unused variable — branch is created for side effect
    void branch;
  }

  async resume(taskBranchId: string): Promise<TaskBranch> {
    const branch = this.store.findById(taskBranchId);
    if (branch === undefined) {
      throw new SessionNotFoundError(taskBranchId);
    }

    const healthy = await this.worktreeManager.isWorktreeHealthy(
      branch.worktreePath,
      branch.repoPath,
    );
    if (!healthy) {
      this.store.updateStatus(branch.id, "broken");
      throw new SessionBrokenError(taskBranchId);
    }

    this.store.updateStatus(branch.id, "active");
    this.detector.stopPolling(branch.sessionId);
    this.detector.startPolling(branch.repoPath, branch.sessionId);

    const updated = this.store.findById(taskBranchId);
    // findById is guaranteed to return a value here since we just updated it
    return updated as TaskBranch;
  }

  async delete(taskBranchId: string, opts: { force: boolean }): Promise<void> {
    const branch = this.store.findById(taskBranchId);
    if (branch === undefined) {
      throw new SessionNotFoundError(taskBranchId);
    }

    if (!opts.force) {
      const hasChanges = await this.hasUncommittedChanges(taskBranchId);
      if (hasChanges) {
        throw new UncommittedChangesError(taskBranchId);
      }
    }

    await this.worktreeManager.removeWorktree(branch.worktreePath);
    this.store.softDelete(taskBranchId);
    this.detector.stopPolling(branch.sessionId);
  }

  async hasUncommittedChanges(taskBranchId: string): Promise<boolean> {
    const branch = this.store.findById(taskBranchId);
    if (branch === undefined) return false;
    const { stdout } = await this.execGit(
      ["status", "--porcelain"],
      branch.worktreePath,
    );
    return stdout.trim().length > 0;
  }

  getMode(repoPath?: string): OperatingMode {
    if (repoPath !== undefined) {
      return this.repoModes.get(repoPath) ?? this.globalMode;
    }
    return this.globalMode;
  }

  setMode(mode: OperatingMode, repoPath?: string): void {
    if (repoPath !== undefined) {
      this.repoModes.set(repoPath, mode);
    } else {
      this.globalMode = mode;
    }
  }

  async initialize(): Promise<void> {
    await this.store.scanIntegrity(this.execGit);
    const staleBefore = Date.now() - this.staleDays * 24 * 60 * 60 * 1000;
    this.store.applyStaleThreshold(staleBefore);
    await this.store.detectMerged(this.execGit);
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export interface SessionManagerDeps {
  readonly store: TaskBranchStore;
  readonly worktreeManager: WorktreeManager;
  readonly detector: FileModificationDetector;
  readonly execGit: ExecGit;
  readonly staleDays?: number;
}

export function createSessionManager(deps: SessionManagerDeps): SessionManager {
  return new SessionManager(
    deps.store,
    deps.worktreeManager,
    deps.detector,
    deps.execGit,
    deps.staleDays,
  );
}
