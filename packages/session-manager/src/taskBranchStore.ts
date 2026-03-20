import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

// ─── Types ───────────────────────────────────────────────────────────────────

export type TaskBranchStatus = "active" | "stale" | "merged" | "broken";
export type OperatingMode = "managed" | "advisory";
export type MissionSource = "declared" | "inferred";

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

export interface CreateTaskBranchInput {
  readonly sessionId: string;
  readonly repoPath: string;
  readonly worktreePath: string;
  readonly branchName: string;
  readonly missionLabel: string;
  readonly missionSource: MissionSource;
  readonly mode: OperatingMode;
}

export interface UpdateActivityInput {
  readonly taskBranchId: string;
  readonly lastActivityAt: number;
}

export type ExecGit = (
  args: string[],
  cwd?: string,
) => Promise<{ stdout: string; stderr: string }>;

export interface TaskBranchStore {
  create(input: CreateTaskBranchInput): TaskBranch;
  findById(id: string): TaskBranch | undefined;
  findBySessionId(sessionId: string): TaskBranch | undefined;
  listAll(): readonly TaskBranch[];
  updateStatus(id: string, status: TaskBranchStatus): void;
  updateActivity(input: UpdateActivityInput): void;
  softDelete(id: string): void;
  applyStaleThreshold(staleBefore: number): void;
  detectMerged(execGit: ExecGit): Promise<void>;
  scanIntegrity(execGit: ExecGit): Promise<void>;
  close(): void;
}

// ─── Internal Types ──────────────────────────────────────────────────────────

interface StoredRow {
  id: string;
  session_id: string;
  repo_path: string;
  worktree_path: string;
  branch_name: string;
  mission_label: string;
  mission_source: string;
  mode: string;
  status: string;
  created_at: number;
  last_activity_at: number;
  deleted_at: number | null;
}

interface IntegrityRow {
  id: string;
  worktree_path: string;
  repo_path: string;
}

interface RunResult {
  changes: number;
}

// ─── Schema ──────────────────────────────────────────────────────────────────

const CREATE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS task_branches (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    repo_path TEXT NOT NULL,
    worktree_path TEXT NOT NULL,
    branch_name TEXT NOT NULL,
    mission_label TEXT NOT NULL,
    mission_source TEXT NOT NULL CHECK (mission_source IN ('declared','inferred')),
    mode TEXT NOT NULL CHECK (mode IN ('managed','advisory')),
    status TEXT NOT NULL CHECK (status IN ('active','stale','merged','broken')),
    created_at INTEGER NOT NULL,
    last_activity_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_task_branches_session_id
    ON task_branches (session_id) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_task_branches_repo_path ON task_branches (repo_path);
  CREATE INDEX IF NOT EXISTS idx_task_branches_status ON task_branches (status) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_task_branches_last_activity ON task_branches (last_activity_at) WHERE deleted_at IS NULL;
`;

// ─── Row Mapping ─────────────────────────────────────────────────────────────

export function mapRowToTaskBranch(row: StoredRow): TaskBranch {
  return {
    id: row.id,
    sessionId: row.session_id,
    repoPath: row.repo_path,
    worktreePath: row.worktree_path,
    branchName: row.branch_name,
    missionLabel: row.mission_label,
    missionSource: row.mission_source as MissionSource,
    mode: row.mode as OperatingMode,
    status: row.status as TaskBranchStatus,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
  };
}

// ─── Worktree Health Check (used by scanIntegrity) ───────────────────────────

async function isWorktreeHealthy(
  worktreePath: string,
  repoPath: string,
  execGit: ExecGit,
): Promise<boolean> {
  if (!existsSync(worktreePath)) return false;
  try {
    const { stdout } = await execGit(
      ["worktree", "list", "--porcelain"],
      repoPath,
    );
    return stdout.includes(`worktree ${worktreePath}`);
  } catch {
    return false;
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function openTaskBranchStore(dbPath?: string): TaskBranchStore {
  const defaultPath = `${homedir()}/.joyus/session-manager.db`;
  const resolvedPath = dbPath ?? defaultPath;

  mkdirSync(dirname(resolvedPath), { recursive: true });

  const db = new DatabaseSync(resolvedPath);
  db.exec(CREATE_SCHEMA);
  let closed = false;

  const insertStmt = db.prepare(
    `INSERT INTO task_branches (id, session_id, repo_path, worktree_path, branch_name, mission_label, mission_source, mode, status, created_at, last_activity_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  );

  const findByIdStmt = db.prepare(
    `SELECT * FROM task_branches WHERE id = ? AND deleted_at IS NULL`,
  );

  const findBySessionStmt = db.prepare(
    `SELECT * FROM task_branches WHERE session_id = ? AND deleted_at IS NULL`,
  );

  const listAllStmt = db.prepare(
    `SELECT * FROM task_branches WHERE deleted_at IS NULL ORDER BY last_activity_at DESC`,
  );

  const updateStatusStmt = db.prepare(
    `UPDATE task_branches SET status = ? WHERE id = ?`,
  );

  const updateActivityStmt = db.prepare(
    `UPDATE task_branches SET last_activity_at = ? WHERE id = ?`,
  );

  const softDeleteStmt = db.prepare(
    `UPDATE task_branches SET deleted_at = ? WHERE id = ?`,
  );

  const applyStaleStmt = db.prepare(
    `UPDATE task_branches SET status = 'stale' WHERE status = 'active' AND last_activity_at < ? AND deleted_at IS NULL`,
  );

  const detectMergedListStmt = db.prepare(
    `SELECT id, branch_name, repo_path FROM task_branches WHERE status IN ('active', 'stale') AND deleted_at IS NULL`,
  );

  const integrityListStmt = db.prepare(
    `SELECT id, worktree_path, repo_path FROM task_branches WHERE status != 'broken' AND deleted_at IS NULL`,
  );

  return {
    create(input: CreateTaskBranchInput): TaskBranch {
      const id = randomUUID();
      const now = Date.now();

      insertStmt.run(
        id,
        input.sessionId,
        input.repoPath,
        input.worktreePath,
        input.branchName,
        input.missionLabel,
        input.missionSource,
        input.mode,
        "active",
        now,
        now,
      );

      return {
        id,
        sessionId: input.sessionId,
        repoPath: input.repoPath,
        worktreePath: input.worktreePath,
        branchName: input.branchName,
        missionLabel: input.missionLabel,
        missionSource: input.missionSource,
        mode: input.mode,
        status: "active",
        createdAt: now,
        lastActivityAt: now,
      };
    },

    findById(id: string): TaskBranch | undefined {
      const row = findByIdStmt.get(id) as unknown as StoredRow | undefined;
      if (row === undefined) {
        return undefined;
      }
      return mapRowToTaskBranch(row);
    },

    findBySessionId(sessionId: string): TaskBranch | undefined {
      const row = findBySessionStmt.get(sessionId) as unknown as
        | StoredRow
        | undefined;
      if (row === undefined) {
        return undefined;
      }
      return mapRowToTaskBranch(row);
    },

    listAll(): readonly TaskBranch[] {
      const rows = listAllStmt.all() as unknown as StoredRow[];
      return rows.map(mapRowToTaskBranch);
    },

    updateStatus(id: string, status: TaskBranchStatus): void {
      updateStatusStmt.run(status, id);
    },

    updateActivity(input: UpdateActivityInput): void {
      updateActivityStmt.run(input.lastActivityAt, input.taskBranchId);
    },

    softDelete(id: string): void {
      softDeleteStmt.run(Date.now(), id);
    },

    applyStaleThreshold(staleBefore: number): void {
      applyStaleStmt.run(staleBefore);
    },

    async detectMerged(execGit: ExecGit): Promise<void> {
      const rows = detectMergedListStmt.all() as unknown as Array<{
        id: string;
        branch_name: string;
        repo_path: string;
      }>;

      for (const row of rows) {
        try {
          const { stdout } = await execGit(
            ["branch", "--merged", "HEAD"],
            row.repo_path,
          );
          const branches = stdout
            .split("\n")
            .map((line) => line.replace(/^\*?\s+/, "").trim());
          if (branches.includes(row.branch_name)) {
            updateStatusStmt.run("merged", row.id);
          }
        } catch {
          // execGit errors must not throw — skip and continue
        }
      }
    },

    async scanIntegrity(execGit: ExecGit): Promise<void> {
      const rows = integrityListStmt.all() as unknown as IntegrityRow[];

      for (const row of rows) {
        const healthy = await isWorktreeHealthy(
          row.worktree_path,
          row.repo_path,
          execGit,
        );
        if (!healthy) {
          updateStatusStmt.run("broken", row.id);
        }
      }
    },

    close(): void {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}
