import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface ConsumedToken {
  jti: string;
  tenantId: string;
  consumedAt: number;
  expiresAt: number;
}

export interface ConsumeResult {
  ok: boolean;
  originalConsumedAt?: number;
}

export interface ReplayCache {
  consume(token: ConsumedToken): ConsumeResult;
  prune(): number;
  close(): void;
}

export interface ReplayCacheOptions {
  dbPath?: string;
}

interface StoredRow {
  consumed_at: number;
}

interface RunResult {
  changes: number;
}

export function openReplayCache(options?: ReplayCacheOptions): ReplayCache {
  const rawPath = options?.dbPath ?? "~/.joyus/replay-cache.db";
  const resolvedPath = rawPath.startsWith("~/")
    ? `${homedir()}${rawPath.slice(1)}`
    : rawPath;

  mkdirSync(dirname(resolvedPath), { recursive: true });

  const db = new DatabaseSync(resolvedPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS consumed_tokens (
      jti TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      consumed_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (jti, tenant_id)
    )
  `);

  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO consumed_tokens (jti, tenant_id, consumed_at, expires_at) VALUES (?, ?, ?, ?)`
  );
  const selectStmt = db.prepare(
    `SELECT consumed_at FROM consumed_tokens WHERE jti = ? AND tenant_id = ?`
  );
  const pruneStmt = db.prepare(
    `DELETE FROM consumed_tokens WHERE expires_at < ?`
  );

  return {
    consume(token: ConsumedToken): ConsumeResult {
      const result = insertStmt.run(token.jti, token.tenantId, token.consumedAt, token.expiresAt) as RunResult;

      if (result.changes === 1) {
        return { ok: true };
      }

      const row = selectStmt.get(token.jti, token.tenantId) as unknown as StoredRow;
      return { ok: false, originalConsumedAt: row.consumed_at };
    },

    prune(): number {
      const nowSec = Math.floor(Date.now() / 1000);
      const result = pruneStmt.run(nowSec) as RunResult;
      return result.changes;
    },

    close(): void {
      db.close();
    }
  };
}
