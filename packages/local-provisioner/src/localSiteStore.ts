import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

// ─── Types ───────────────────────────────────────────────────────────────────

export type LocalSiteStatus = "running" | "stopped" | "starting" | "error";

export interface LocalSite {
  readonly id: string;
  readonly projectName: string;
  readonly repoUrl: string;
  readonly repoPath: string;
  readonly ddevProjectName: string;
  readonly httpUrl: string | undefined;
  readonly httpsUrl: string | undefined;
  readonly status: LocalSiteStatus;
  readonly errorMessage: string | undefined;
  readonly projectType: string | undefined;
  readonly createdAt: number;
  readonly lastActivityAt: number;
}

export interface LocalSiteStore {
  create(site: Omit<LocalSite, "id" | "createdAt" | "lastActivityAt">): LocalSite;
  findById(id: string): LocalSite | undefined;
  findByRepoPath(repoPath: string): LocalSite | undefined;
  listAll(): readonly LocalSite[];
  updateStatus(id: string, status: LocalSiteStatus, errorMessage?: string): void;
  updateUrls(id: string, httpUrl: string, httpsUrl: string): void;
  updateActivity(id: string): void;
  softDelete(id: string): void;
  close(): void;
}

// ─── Internal Types ──────────────────────────────────────────────────────────

interface StoredRow {
  id: string;
  project_name: string;
  repo_url: string;
  repo_path: string;
  ddev_project_name: string;
  http_url: string | null;
  https_url: string | null;
  status: string;
  error_message: string | null;
  project_type: string | null;
  created_at: number;
  last_activity_at: number;
  deleted_at: number | null;
}

// ─── Schema ──────────────────────────────────────────────────────────────────

const CREATE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS local_sites (
    id TEXT PRIMARY KEY,
    project_name TEXT NOT NULL,
    repo_url TEXT NOT NULL,
    repo_path TEXT NOT NULL,
    ddev_project_name TEXT NOT NULL,
    http_url TEXT,
    https_url TEXT,
    status TEXT NOT NULL CHECK (status IN ('running','stopped','starting','error')),
    error_message TEXT,
    project_type TEXT,
    created_at INTEGER NOT NULL,
    last_activity_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_local_sites_repo_path
    ON local_sites (repo_path) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_local_sites_status
    ON local_sites (status) WHERE deleted_at IS NULL;
`;

// ─── Row Mapping ─────────────────────────────────────────────────────────────

export function mapRowToLocalSite(row: StoredRow): LocalSite {
  return {
    id: row.id,
    projectName: row.project_name,
    repoUrl: row.repo_url,
    repoPath: row.repo_path,
    ddevProjectName: row.ddev_project_name,
    httpUrl: row.http_url ?? undefined,
    httpsUrl: row.https_url ?? undefined,
    status: row.status as LocalSiteStatus,
    errorMessage: row.error_message ?? undefined,
    projectType: row.project_type ?? undefined,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
  };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function openLocalSiteStore(dbPath?: string): LocalSiteStore {
  const defaultPath = `${homedir()}/.joyus/local-provisioner.db`;
  /* v8 ignore next */
  const resolvedPath = dbPath ?? defaultPath;

  mkdirSync(dirname(resolvedPath), { recursive: true });

  const db = new DatabaseSync(resolvedPath);
  db.exec(CREATE_SCHEMA);
  let closed = false;

  const insertStmt = db.prepare(
    `INSERT INTO local_sites
       (id, project_name, repo_url, repo_path, ddev_project_name, http_url, https_url,
        status, error_message, project_type, created_at, last_activity_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  );

  const findByIdStmt = db.prepare(
    `SELECT * FROM local_sites WHERE id = ? AND deleted_at IS NULL`,
  );

  const findByRepoPathStmt = db.prepare(
    `SELECT * FROM local_sites WHERE repo_path = ? AND deleted_at IS NULL`,
  );

  const listAllStmt = db.prepare(
    `SELECT * FROM local_sites WHERE deleted_at IS NULL ORDER BY last_activity_at DESC`,
  );

  const updateStatusStmt = db.prepare(
    `UPDATE local_sites SET status = ?, error_message = ? WHERE id = ?`,
  );

  const updateUrlsStmt = db.prepare(
    `UPDATE local_sites SET http_url = ?, https_url = ? WHERE id = ?`,
  );

  const updateActivityStmt = db.prepare(
    `UPDATE local_sites SET last_activity_at = ? WHERE id = ?`,
  );

  const softDeleteStmt = db.prepare(
    `UPDATE local_sites SET deleted_at = ? WHERE id = ?`,
  );

  return {
    create(
      site: Omit<LocalSite, "id" | "createdAt" | "lastActivityAt">,
    ): LocalSite {
      const id = randomUUID();
      const now = Date.now();

      insertStmt.run(
        id,
        site.projectName,
        site.repoUrl,
        site.repoPath,
        site.ddevProjectName,
        site.httpUrl ?? null,
        site.httpsUrl ?? null,
        site.status,
        site.errorMessage ?? null,
        site.projectType ?? null,
        now,
        now,
      );

      return {
        id,
        projectName: site.projectName,
        repoUrl: site.repoUrl,
        repoPath: site.repoPath,
        ddevProjectName: site.ddevProjectName,
        httpUrl: site.httpUrl,
        httpsUrl: site.httpsUrl,
        status: site.status,
        errorMessage: site.errorMessage,
        projectType: site.projectType,
        createdAt: now,
        lastActivityAt: now,
      };
    },

    findById(id: string): LocalSite | undefined {
      const row = findByIdStmt.get(id) as unknown as StoredRow | undefined;
      if (row === undefined) return undefined;
      return mapRowToLocalSite(row);
    },

    findByRepoPath(repoPath: string): LocalSite | undefined {
      const row = findByRepoPathStmt.get(repoPath) as unknown as
        | StoredRow
        | undefined;
      if (row === undefined) return undefined;
      return mapRowToLocalSite(row);
    },

    listAll(): readonly LocalSite[] {
      const rows = listAllStmt.all() as unknown as StoredRow[];
      return rows.map(mapRowToLocalSite);
    },

    updateStatus(
      id: string,
      status: LocalSiteStatus,
      errorMessage?: string,
    ): void {
      updateStatusStmt.run(status, errorMessage ?? null, id);
    },

    updateUrls(id: string, httpUrl: string, httpsUrl: string): void {
      updateUrlsStmt.run(httpUrl, httpsUrl, id);
    },

    updateActivity(id: string): void {
      updateActivityStmt.run(Date.now(), id);
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
