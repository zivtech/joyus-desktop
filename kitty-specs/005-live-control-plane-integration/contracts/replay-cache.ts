/**
 * Contract: ReplayCache
 *
 * SQLite-backed (node:sqlite) cache for consumed decision token JTIs.
 * Persists across companion restarts to prevent replay of old tokens.
 *
 * NOTE: This is the contract (interface + types only).
 * Implementation lives in packages/policy-client/src/replayCache.ts
 */

export interface ReplayCacheRecord {
  jti: string;
  tenantId: string;
  consumedAt: number; // Unix epoch seconds
  expiresAt: number;  // Unix epoch seconds (from token exp claim)
}

export interface ReplayCacheResult {
  /** true = JTI was not previously consumed; recorded and allowed to proceed */
  ok: true;
} | {
  /** false = JTI already exists; this is a replay attempt */
  ok: false;
  reason: "replay";
  originalConsumedAt: number;
}

export interface ReplayCache {
  /**
   * Attempt to consume a JTI. Returns ok=true on first use,
   * ok=false with reason="replay" if already consumed.
   * Atomically writes on first use.
   */
  consume(record: ReplayCacheRecord): ReplayCacheResult;

  /**
   * Remove all entries where expiresAt + 3600 < now.
   * Called at startup to bound file size.
   */
  prune(nowEpochSeconds?: number): number; // returns count pruned

  /**
   * Close the SQLite connection. Call on companion shutdown.
   */
  close(): void;
}

export interface ReplayCacheDeps {
  /** Path to the SQLite database file. */
  dbPath: string;
  /** Injectable current time for testability. Defaults to Math.floor(Date.now()/1000). */
  nowEpochSeconds?: () => number;
}

export type OpenReplayCache = (deps: ReplayCacheDeps) => ReplayCache;
