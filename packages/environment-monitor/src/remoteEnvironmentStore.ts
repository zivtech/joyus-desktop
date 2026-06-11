import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

// ─── Types ────────────────────────────────────────────────────────────────────

export type EnvironmentType = "probo" | "joyus-ai-hosted";
export type RemoteEnvironmentStatus =
  | "building"
  | "ready"
  | "failed"
  | "expired"
  | "provisioning";

export interface RemoteEnvironment {
  readonly id: string;
  readonly repoOwner: string;
  readonly repoName: string;
  readonly environmentType: EnvironmentType;
  readonly prNumber: number | undefined;
  readonly prUrl: string | undefined;
  readonly prTitle: string | undefined;
  readonly deploymentId: number | undefined;
  readonly environmentUrl: string | undefined;
  readonly status: RemoteEnvironmentStatus;
  readonly taskBranchId: string | undefined;
  readonly errorMessage: string | undefined;
  readonly lastCheckedAt: number;
  readonly createdAt: number;
}

export interface RemoteEnvironmentStore {
  upsertFromDeployment(
    env: Omit<RemoteEnvironment, "id" | "createdAt">,
  ): RemoteEnvironment;
  findById(id: string): RemoteEnvironment | undefined;
  findByDeploymentId(deploymentId: number): RemoteEnvironment | undefined;
  findByTaskBranchId(taskBranchId: string): RemoteEnvironment | undefined;
  listByRepo(
    repoOwner: string,
    repoName: string,
  ): readonly RemoteEnvironment[];
  listAll(): readonly RemoteEnvironment[];
  updateStatus(
    id: string,
    status: RemoteEnvironmentStatus,
    environmentUrl?: string,
  ): void;
  updateLastChecked(id: string): void;
  softDelete(id: string): void;
  close(): void;
}

// ─── Internal Types ───────────────────────────────────────────────────────────

interface StoredRow {
  id: string;
  repo_owner: string;
  repo_name: string;
  environment_type: string;
  pr_number: number | null;
  pr_url: string | null;
  pr_title: string | null;
  deployment_id: number | null;
  environment_url: string | null;
  status: string;
  task_branch_id: string | null;
  error_message: string | null;
  last_checked_at: number;
  created_at: number;
  deleted_at: number | null;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const CREATE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS remote_environments (
    id TEXT PRIMARY KEY,
    repo_owner TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    environment_type TEXT NOT NULL CHECK (environment_type IN ('probo','joyus-ai-hosted')),
    pr_number INTEGER,
    pr_url TEXT,
    pr_title TEXT,
    deployment_id INTEGER,
    environment_url TEXT,
    status TEXT NOT NULL CHECK (status IN ('building','ready','failed','expired','provisioning')),
    task_branch_id TEXT,
    error_message TEXT,
    last_checked_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_remote_envs_deployment
    ON remote_environments (deployment_id) WHERE deleted_at IS NULL AND deployment_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_remote_envs_repo
    ON remote_environments (repo_owner, repo_name) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_remote_envs_task_branch
    ON remote_environments (task_branch_id) WHERE deleted_at IS NULL AND task_branch_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_remote_envs_status
    ON remote_environments (status) WHERE deleted_at IS NULL;
`;

// ─── Row Mapping ──────────────────────────────────────────────────────────────

export function mapRowToRemoteEnvironment(row: StoredRow): RemoteEnvironment {
  return {
    id: row.id,
    repoOwner: row.repo_owner,
    repoName: row.repo_name,
    environmentType: row.environment_type as EnvironmentType,
    prNumber: row.pr_number ?? undefined,
    prUrl: row.pr_url ?? undefined,
    prTitle: row.pr_title ?? undefined,
    deploymentId: row.deployment_id ?? undefined,
    environmentUrl: row.environment_url ?? undefined,
    status: row.status as RemoteEnvironmentStatus,
    taskBranchId: row.task_branch_id ?? undefined,
    errorMessage: row.error_message ?? undefined,
    lastCheckedAt: row.last_checked_at,
    createdAt: row.created_at,
  };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function openRemoteEnvironmentStore(
  dbPath?: string,
): RemoteEnvironmentStore {
  const defaultPath = `${homedir()}/.joyus/environment-monitor.db`;
  const resolvedPath = dbPath ?? defaultPath;

  mkdirSync(dirname(resolvedPath), { recursive: true });

  const db = new DatabaseSync(resolvedPath);
  db.exec(CREATE_SCHEMA);
  let closed = false;

  const findByDeploymentStmt = db.prepare(
    `SELECT * FROM remote_environments WHERE deployment_id = ? AND deleted_at IS NULL`,
  );

  const insertStmt = db.prepare(
    `INSERT INTO remote_environments
      (id, repo_owner, repo_name, environment_type, pr_number, pr_url, pr_title,
       deployment_id, environment_url, status, task_branch_id, error_message,
       last_checked_at, created_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  );

  const updateUpsertStmt = db.prepare(
    `UPDATE remote_environments SET
      repo_owner = ?, repo_name = ?, environment_type = ?, pr_number = ?,
      pr_url = ?, pr_title = ?, deployment_id = ?, environment_url = ?,
      status = ?, task_branch_id = ?, error_message = ?, last_checked_at = ?
     WHERE id = ?`,
  );

  const findByIdStmt = db.prepare(
    `SELECT * FROM remote_environments WHERE id = ? AND deleted_at IS NULL`,
  );

  const findByTaskBranchStmt = db.prepare(
    `SELECT * FROM remote_environments WHERE task_branch_id = ? AND deleted_at IS NULL LIMIT 1`,
  );

  const listByRepoStmt = db.prepare(
    `SELECT * FROM remote_environments WHERE repo_owner = ? AND repo_name = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
  );

  const listAllStmt = db.prepare(
    `SELECT * FROM remote_environments WHERE deleted_at IS NULL ORDER BY created_at DESC`,
  );

  const updateStatusStmt = db.prepare(
    `UPDATE remote_environments SET status = ?, environment_url = COALESCE(?, environment_url) WHERE id = ?`,
  );

  const updateLastCheckedStmt = db.prepare(
    `UPDATE remote_environments SET last_checked_at = ? WHERE id = ?`,
  );

  const softDeleteStmt = db.prepare(
    `UPDATE remote_environments SET deleted_at = ? WHERE id = ?`,
  );

  return {
    upsertFromDeployment(
      env: Omit<RemoteEnvironment, "id" | "createdAt">,
    ): RemoteEnvironment {
      const now = Date.now();

      // If deploymentId is provided, try to find existing record
      if (env.deploymentId !== undefined) {
        const existing = findByDeploymentStmt.get(
          env.deploymentId,
        ) as unknown as StoredRow | undefined;

        if (existing !== undefined) {
          updateUpsertStmt.run(
            env.repoOwner,
            env.repoName,
            env.environmentType,
            env.prNumber ?? null,
            env.prUrl ?? null,
            env.prTitle ?? null,
            env.deploymentId,
            env.environmentUrl ?? null,
            env.status,
            env.taskBranchId ?? null,
            env.errorMessage ?? null,
            env.lastCheckedAt,
            existing.id,
          );
          return {
            id: existing.id,
            repoOwner: env.repoOwner,
            repoName: env.repoName,
            environmentType: env.environmentType,
            prNumber: env.prNumber,
            prUrl: env.prUrl,
            prTitle: env.prTitle,
            deploymentId: env.deploymentId,
            environmentUrl: env.environmentUrl,
            status: env.status,
            taskBranchId: env.taskBranchId,
            errorMessage: env.errorMessage,
            lastCheckedAt: env.lastCheckedAt,
            createdAt: existing.created_at,
          };
        }
      }

      // Insert new record
      const id = randomUUID();
      insertStmt.run(
        id,
        env.repoOwner,
        env.repoName,
        env.environmentType,
        env.prNumber ?? null,
        env.prUrl ?? null,
        env.prTitle ?? null,
        env.deploymentId ?? null,
        env.environmentUrl ?? null,
        env.status,
        env.taskBranchId ?? null,
        env.errorMessage ?? null,
        env.lastCheckedAt,
        now,
      );

      return {
        id,
        repoOwner: env.repoOwner,
        repoName: env.repoName,
        environmentType: env.environmentType,
        prNumber: env.prNumber,
        prUrl: env.prUrl,
        prTitle: env.prTitle,
        deploymentId: env.deploymentId,
        environmentUrl: env.environmentUrl,
        status: env.status,
        taskBranchId: env.taskBranchId,
        errorMessage: env.errorMessage,
        lastCheckedAt: env.lastCheckedAt,
        createdAt: now,
      };
    },

    findById(id: string): RemoteEnvironment | undefined {
      const row = findByIdStmt.get(id) as unknown as StoredRow | undefined;
      if (row === undefined) return undefined;
      return mapRowToRemoteEnvironment(row);
    },

    findByDeploymentId(deploymentId: number): RemoteEnvironment | undefined {
      const row = findByDeploymentStmt.get(
        deploymentId,
      ) as unknown as StoredRow | undefined;
      if (row === undefined) return undefined;
      return mapRowToRemoteEnvironment(row);
    },

    findByTaskBranchId(taskBranchId: string): RemoteEnvironment | undefined {
      const row = findByTaskBranchStmt.get(
        taskBranchId,
      ) as unknown as StoredRow | undefined;
      if (row === undefined) return undefined;
      return mapRowToRemoteEnvironment(row);
    },

    listByRepo(
      repoOwner: string,
      repoName: string,
    ): readonly RemoteEnvironment[] {
      const rows = listByRepoStmt.all(
        repoOwner,
        repoName,
      ) as unknown as StoredRow[];
      return rows.map(mapRowToRemoteEnvironment);
    },

    listAll(): readonly RemoteEnvironment[] {
      const rows = listAllStmt.all() as unknown as StoredRow[];
      return rows.map(mapRowToRemoteEnvironment);
    },

    updateStatus(
      id: string,
      status: RemoteEnvironmentStatus,
      environmentUrl?: string,
    ): void {
      updateStatusStmt.run(status, environmentUrl ?? null, id);
    },

    updateLastChecked(id: string): void {
      updateLastCheckedStmt.run(Date.now(), id);
    },

    softDelete(id: string): void {
      softDeleteStmt.run(Date.now(), id);
    },

    close(): void {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}
