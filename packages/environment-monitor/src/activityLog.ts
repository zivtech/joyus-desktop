import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

// ─── Constants ────────────────────────────────────────────────────────────────

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActivityEventType =
  | "environment_created"
  | "environment_updated"
  | "environment_expired"
  | "environment_failed"
  | "environment_deleted"
  | "status_changed"
  | "check_performed";

export interface ActivityLogEntry {
  readonly id: string;
  readonly repoOwner: string;
  readonly repoName: string;
  readonly eventType: ActivityEventType;
  readonly detail: string | undefined;
  readonly occurredAt: number;
}

export interface AppendActivityInput {
  readonly repoOwner: string;
  readonly repoName: string;
  readonly eventType: ActivityEventType;
  readonly detail?: string;
  readonly occurredAt?: number;
}

export interface ActivityLog {
  append(input: AppendActivityInput): ActivityLogEntry;
  listRecent(limit: number): readonly ActivityLogEntry[];
  listByRepo(
    repoOwner: string,
    repoName: string,
    limit?: number,
  ): readonly ActivityLogEntry[];
  pruneOlderThan(cutoffMs: number): number;
}

// ─── Internal Types ───────────────────────────────────────────────────────────

interface StoredRow {
  id: string;
  repo_owner: string;
  repo_name: string;
  event_type: string;
  detail: string | null;
  occurred_at: number;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const CREATE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    repo_owner TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN (
      'environment_created','environment_updated','environment_expired',
      'environment_failed','environment_deleted','status_changed','check_performed'
    )),
    detail TEXT,
    occurred_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_activity_log_occurred_at
    ON activity_log (occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_activity_log_repo
    ON activity_log (repo_owner, repo_name, occurred_at DESC);
`;

// ─── Row Mapping ──────────────────────────────────────────────────────────────

function mapRowToEntry(row: StoredRow): ActivityLogEntry {
  return {
    id: row.id,
    repoOwner: row.repo_owner,
    repoName: row.repo_name,
    eventType: row.event_type as ActivityEventType,
    detail: row.detail ?? undefined,
    occurredAt: row.occurred_at,
  };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function openActivityLog(db: DatabaseSync): ActivityLog {
  db.exec(CREATE_SCHEMA);

  // Startup pruning: remove entries older than 30 days on first access
  const cutoff = Date.now() - THIRTY_DAYS_MS;
  db.prepare(`DELETE FROM activity_log WHERE occurred_at < ?`).run(cutoff);

  const insertStmt = db.prepare(
    `INSERT INTO activity_log (id, repo_owner, repo_name, event_type, detail, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const listRecentStmt = db.prepare(
    `SELECT * FROM activity_log ORDER BY occurred_at DESC LIMIT ?`,
  );

  const listByRepoStmt = db.prepare(
    `SELECT * FROM activity_log WHERE repo_owner = ? AND repo_name = ? ORDER BY occurred_at DESC LIMIT ?`,
  );

  const pruneStmt = db.prepare(
    `DELETE FROM activity_log WHERE occurred_at < ?`,
  );

  const countChangesStmt = db.prepare(`SELECT changes() AS n`);

  return {
    append(input: AppendActivityInput): ActivityLogEntry {
      const id = randomUUID();
      const occurredAt = input.occurredAt ?? Date.now();
      const detail = input.detail ?? null;

      insertStmt.run(
        id,
        input.repoOwner,
        input.repoName,
        input.eventType,
        detail,
        occurredAt,
      );

      return {
        id,
        repoOwner: input.repoOwner,
        repoName: input.repoName,
        eventType: input.eventType,
        detail: detail ?? undefined,
        occurredAt,
      };
    },

    listRecent(limit: number): readonly ActivityLogEntry[] {
      const rows = listRecentStmt.all(limit) as unknown as StoredRow[];
      return rows.map(mapRowToEntry);
    },

    listByRepo(
      repoOwner: string,
      repoName: string,
      limit = 100,
    ): readonly ActivityLogEntry[] {
      const rows = listByRepoStmt.all(
        repoOwner,
        repoName,
        limit,
      ) as unknown as StoredRow[];
      return rows.map(mapRowToEntry);
    },

    pruneOlderThan(cutoffMs: number): number {
      pruneStmt.run(cutoffMs);
      const result = countChangesStmt.get() as unknown as { n: number };
      return result.n;
    },
  };
}
