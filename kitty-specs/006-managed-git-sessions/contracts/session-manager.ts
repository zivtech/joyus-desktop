/**
 * Contract: packages/session-manager
 *
 * Defines the public API surface for TaskBranch lifecycle management.
 * Worktree operations and SQLite persistence are implementation details;
 * consumers depend only on these types and functions.
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

export type TaskBranchStatus = "active" | "stale" | "merged" | "broken";
export type OperatingMode = "managed" | "advisory";
export type MissionSource = "declared" | "inferred";

// ─── Core Entity ──────────────────────────────────────────────────────────────

export interface TaskBranch {
  readonly id: string;
  readonly sessionId: string;
  readonly repoPath: string;
  readonly worktreePath: string;
  readonly branchName: string;
  readonly missionLabel: string;
  readonly missionSource: MissionSource;
  readonly mode: OperatingMode;
  readonly status: TaskBranchStatus;
  readonly createdAt: number;
  readonly lastActivityAt: number;
}

// ─── File Modification Event ──────────────────────────────────────────────────

export interface FileModificationEvent {
  readonly sessionId: string;
  /** Absolute path to the git repository root (traversed up from filePath). */
  readonly repoPath: string;
  /** Absolute path to the modified file. */
  readonly filePath: string;
  readonly detectedAt: number;
  /** "hook" = Claude Code PostToolUse IPC; "poll" = git-status polling */
  readonly source: "hook" | "poll";
}

// ─── Input Types ─────────────────────────────────────────────────────────────

export interface CreateTaskBranchInput {
  readonly sessionId: string;
  readonly repoPath: string;
  /** User-declared mission label. If absent, label is auto-inferred. */
  readonly missionLabel?: string;
  readonly mode: OperatingMode;
}

export interface UpdateActivityInput {
  readonly taskBranchId: string;
  readonly lastActivityAt: number;
}

// ─── Store Interface ─────────────────────────────────────────────────────────

export interface TaskBranchStore {
  /** Create a new TaskBranch record. Worktree creation happens before this call. */
  create(input: CreateTaskBranchInput & {
    worktreePath: string;
    branchName: string;
    missionLabel: string;
    missionSource: MissionSource;
  }): Promise<TaskBranch>;

  /** Find a TaskBranch by session ID. Returns undefined if not found or soft-deleted. */
  findBySessionId(sessionId: string): Promise<TaskBranch | undefined>;

  /** List all non-deleted TaskBranches, ordered by lastActivityAt DESC. */
  listAll(): Promise<readonly TaskBranch[]>;

  /** Update a TaskBranch's status. */
  updateStatus(id: string, status: TaskBranchStatus): Promise<void>;

  /** Update lastActivityAt timestamp. */
  updateActivity(input: UpdateActivityInput): Promise<void>;

  /** Soft-delete a TaskBranch. */
  softDelete(id: string): Promise<void>;

  /** Apply stale threshold — transitions active branches with old lastActivityAt to stale. */
  applyStaleThreshold(staleBefore: number): Promise<void>;

  /** Detect merged branches by checking if underlying branch is merged into default branch. */
  detectMerged(execGit: ExecGit): Promise<void>;

  /** Startup integrity scan — transitions broken worktrees to "broken" status. */
  scanIntegrity(): Promise<void>;
}

// ─── Worktree Operations ─────────────────────────────────────────────────────

/** Injected git execution function — matches DesktopSyncDeps.execGit signature. */
export type ExecGit = (
  args: string[],
  cwd?: string
) => Promise<{ stdout: string; stderr: string }>;

export interface WorktreeManager {
  /**
   * Create a new worktree for the session. Returns the worktree path and branch name.
   * Handles naming collision by appending a counter suffix.
   */
  create(params: {
    repoPath: string;
    missionSlug: string;
    sessionDate: string;
  }): Promise<{ worktreePath: string; branchName: string }>;

  /** Remove a worktree from disk. Does not delete the underlying branch. */
  remove(worktreePath: string): Promise<void>;

  /** Check whether a worktree path exists and is valid. */
  isHealthy(worktreePath: string, repoPath: string): Promise<boolean>;

  /** List all registered worktrees for a repository. */
  list(repoPath: string): Promise<readonly string[]>;
}

// ─── File Modification Detection ─────────────────────────────────────────────

export interface FileModificationDetector {
  /** Register a listener for file modification events. */
  onModification(handler: (event: FileModificationEvent) => void): void;

  /** Start the polling fallback for the given repository path. */
  startPolling(repoPath: string, sessionId: string): void;

  /** Stop polling for a session. */
  stopPolling(sessionId: string): void;

  /** Handle an incoming IPC hook event (from session.fileModified JSON-RPC call). */
  handleIpcEvent(event: Omit<FileModificationEvent, "detectedAt" | "source">): void;
}

// ─── Session Manager (top-level coordinator) ─────────────────────────────────

export interface SessionManager {
  /**
   * Called when a session.fileModified IPC event or poll detects a file change.
   * In managed mode: creates a TaskBranch if none exists for this session.
   * In advisory mode: no automatic action.
   */
  onFileModification(event: FileModificationEvent): Promise<void>;

  /** Resume a TaskBranch — activates the worktree and clears stale status. */
  resume(taskBranchId: string): Promise<TaskBranch>;

  /** Delete a TaskBranch. Validates uncommitted-change guard before proceeding. */
  delete(taskBranchId: string, opts: { force: boolean }): Promise<void>;

  /** Return whether the TaskBranch has uncommitted changes. */
  hasUncommittedChanges(taskBranchId: string): Promise<boolean>;

  /** Run startup scan — integrity check + stale/merged detection. */
  initialize(): Promise<void>;

  /** Get the global or repo-specific operating mode. */
  getMode(repoPath?: string): OperatingMode;

  /** Update the global or repo-specific operating mode (affects new sessions only). */
  setMode(mode: OperatingMode, repoPath?: string): void;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export interface SessionManagerDeps {
  readonly execGit: ExecGit;
  /** Path to the SQLite database file. Defaults to ~/.joyus/session-manager.db */
  readonly dbPath?: string;
  /** Poll interval in milliseconds. Defaults to 10000. */
  readonly pollIntervalMs?: number;
}

export type OpenSessionManager = (deps: SessionManagerDeps) => Promise<SessionManager>;
