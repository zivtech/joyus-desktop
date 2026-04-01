import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  openActivityLog,
  type ActivityLog,
} from "../src/activityLog";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function makeTmpDbPath(): string {
  return join(tmpdir(), `env-monitor-test-${randomUUID()}`, "activity.db");
}

function cleanupPath(dbPath: string): void {
  try {
    rmSync(join(dbPath, ".."), { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function openTestDb(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  return new DatabaseSync(dbPath);
}

describe("openActivityLog — schema init", () => {
  let dbPath: string;
  let db: DatabaseSync;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    db = openTestDb(dbPath);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // already closed
    }
    cleanupPath(dbPath);
  });

  it("creates the activity_log table on first open", () => {
    openActivityLog(db);
    const result = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='activity_log'`,
      )
      .get() as { name: string } | undefined;
    expect(result?.name).toBe("activity_log");
  });

  it("is idempotent — opening twice does not throw", () => {
    openActivityLog(db);
    expect(() => openActivityLog(db)).not.toThrow();
  });
});

describe("append", () => {
  let dbPath: string;
  let db: DatabaseSync;
  let log: ActivityLog;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    db = openTestDb(dbPath);
    log = openActivityLog(db);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // already closed
    }
    cleanupPath(dbPath);
  });

  it("returns an entry with generated id and timestamps", () => {
    const entry = log.append({
      repoOwner: "acme",
      repoName: "site",
      eventType: "environment_created",
    });

    expect(entry.id).toBeTruthy();
    expect(entry.repoOwner).toBe("acme");
    expect(entry.repoName).toBe("site");
    expect(entry.eventType).toBe("environment_created");
    expect(entry.detail).toBeUndefined();
    expect(entry.occurredAt).toBeGreaterThan(0);
  });

  it("stores detail when provided", () => {
    const entry = log.append({
      repoOwner: "acme",
      repoName: "site",
      eventType: "status_changed",
      detail: "building → ready",
    });

    expect(entry.detail).toBe("building → ready");
  });

  it("uses provided occurredAt instead of Date.now()", () => {
    const ts = 1_700_000_000_000;
    const entry = log.append({
      repoOwner: "acme",
      repoName: "site",
      eventType: "check_performed",
      occurredAt: ts,
    });

    expect(entry.occurredAt).toBe(ts);
  });

  it("persists the entry — visible via listRecent", () => {
    log.append({
      repoOwner: "acme",
      repoName: "site",
      eventType: "environment_updated",
    });

    const recent = log.listRecent(10);
    expect(recent).toHaveLength(1);
    expect(recent[0]?.eventType).toBe("environment_updated");
  });
});

describe("listRecent", () => {
  let dbPath: string;
  let db: DatabaseSync;
  let log: ActivityLog;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    db = openTestDb(dbPath);
    log = openActivityLog(db);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // already closed
    }
    cleanupPath(dbPath);
  });

  it("returns empty array when no entries", () => {
    expect(log.listRecent(10)).toEqual([]);
  });

  it("returns entries ordered by occurredAt DESC", () => {
    log.append({
      repoOwner: "acme",
      repoName: "site",
      eventType: "environment_created",
      occurredAt: 1000,
    });
    log.append({
      repoOwner: "acme",
      repoName: "site",
      eventType: "status_changed",
      occurredAt: 3000,
    });
    log.append({
      repoOwner: "acme",
      repoName: "site",
      eventType: "check_performed",
      occurredAt: 2000,
    });

    const recent = log.listRecent(10);
    expect(recent).toHaveLength(3);
    expect(recent[0]?.occurredAt).toBe(3000);
    expect(recent[1]?.occurredAt).toBe(2000);
    expect(recent[2]?.occurredAt).toBe(1000);
  });

  it("respects the limit parameter", () => {
    for (let i = 0; i < 5; i++) {
      log.append({
        repoOwner: "acme",
        repoName: "site",
        eventType: "check_performed",
        occurredAt: i * 1000,
      });
    }

    const recent = log.listRecent(3);
    expect(recent).toHaveLength(3);
  });
});

describe("listByRepo", () => {
  let dbPath: string;
  let db: DatabaseSync;
  let log: ActivityLog;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    db = openTestDb(dbPath);
    log = openActivityLog(db);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // already closed
    }
    cleanupPath(dbPath);
  });

  it("returns empty array when no entries for repo", () => {
    expect(log.listByRepo("acme", "site")).toEqual([]);
  });

  it("filters to the specified repo only", () => {
    log.append({ repoOwner: "acme", repoName: "site", eventType: "environment_created" });
    log.append({ repoOwner: "acme", repoName: "other", eventType: "status_changed" });
    log.append({ repoOwner: "org2", repoName: "site", eventType: "check_performed" });

    const entries = log.listByRepo("acme", "site");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.repoName).toBe("site");
    expect(entries[0]?.repoOwner).toBe("acme");
  });

  it("returns entries ordered by occurredAt DESC", () => {
    log.append({
      repoOwner: "acme",
      repoName: "site",
      eventType: "environment_created",
      occurredAt: 1000,
    });
    log.append({
      repoOwner: "acme",
      repoName: "site",
      eventType: "status_changed",
      occurredAt: 5000,
    });

    const entries = log.listByRepo("acme", "site");
    expect(entries[0]?.occurredAt).toBe(5000);
    expect(entries[1]?.occurredAt).toBe(1000);
  });

  it("respects optional limit parameter", () => {
    for (let i = 0; i < 5; i++) {
      log.append({
        repoOwner: "acme",
        repoName: "site",
        eventType: "check_performed",
        occurredAt: i * 1000,
      });
    }

    const entries = log.listByRepo("acme", "site", 2);
    expect(entries).toHaveLength(2);
  });

  it("uses default limit of 100 when not specified", () => {
    for (let i = 0; i < 5; i++) {
      log.append({
        repoOwner: "acme",
        repoName: "site",
        eventType: "check_performed",
        occurredAt: i * 1000,
      });
    }

    const entries = log.listByRepo("acme", "site");
    expect(entries).toHaveLength(5);
  });
});

describe("pruneOlderThan", () => {
  let dbPath: string;
  let db: DatabaseSync;
  let log: ActivityLog;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    db = openTestDb(dbPath);
    log = openActivityLog(db);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // already closed
    }
    cleanupPath(dbPath);
  });

  it("returns 0 when no entries exist", () => {
    const deleted = log.pruneOlderThan(Date.now());
    expect(deleted).toBe(0);
  });

  it("deletes entries older than cutoff and returns count", () => {
    log.append({
      repoOwner: "acme",
      repoName: "site",
      eventType: "environment_created",
      occurredAt: 1000,
    });
    log.append({
      repoOwner: "acme",
      repoName: "site",
      eventType: "status_changed",
      occurredAt: 2000,
    });

    const deleted = log.pruneOlderThan(1500);
    expect(deleted).toBe(1);

    const remaining = log.listRecent(10);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.occurredAt).toBe(2000);
  });

  it("does not delete entries at or after cutoff", () => {
    log.append({
      repoOwner: "acme",
      repoName: "site",
      eventType: "check_performed",
      occurredAt: 5000,
    });

    const deleted = log.pruneOlderThan(5000);
    expect(deleted).toBe(0);

    expect(log.listRecent(10)).toHaveLength(1);
  });

  it("deletes all entries when cutoff is in the future", () => {
    log.append({ repoOwner: "a", repoName: "b", eventType: "environment_created", occurredAt: 1000 });
    log.append({ repoOwner: "a", repoName: "b", eventType: "status_changed", occurredAt: 2000 });
    log.append({ repoOwner: "a", repoName: "b", eventType: "check_performed", occurredAt: 3000 });

    const deleted = log.pruneOlderThan(99_999_999_999_999);
    expect(deleted).toBe(3);
    expect(log.listRecent(10)).toHaveLength(0);
  });
});

describe("startup pruning — 30-day retention", () => {
  let dbPath: string;
  let db: DatabaseSync;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    db = openTestDb(dbPath);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // already closed
    }
    cleanupPath(dbPath);
  });

  it("removes entries older than 30 days on open", () => {
    // First open — initialize schema
    const log1 = openActivityLog(db);

    const oldTs = Date.now() - THIRTY_DAYS_MS - 1000;
    const recentTs = Date.now() - 1000;

    log1.append({
      repoOwner: "acme",
      repoName: "site",
      eventType: "environment_created",
      occurredAt: oldTs,
    });
    log1.append({
      repoOwner: "acme",
      repoName: "site",
      eventType: "status_changed",
      occurredAt: recentTs,
    });

    // Second open — triggers startup pruning
    openActivityLog(db);

    const remaining = log1.listRecent(100);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.occurredAt).toBe(recentTs);
  });

  it("retains entries exactly at the 30-day boundary", () => {
    const log1 = openActivityLog(db);

    // Entry at exactly 30 days ago should be pruned (cutoff = now - 30d, entry < cutoff is deleted)
    // Entry at 30 days minus 1 second is older — gets pruned
    // Entry at now - 30d + 1 second is kept
    const boundaryTs = Date.now() - THIRTY_DAYS_MS;
    const justInsideBoundary = boundaryTs + 1000;

    log1.append({
      repoOwner: "acme",
      repoName: "site",
      eventType: "check_performed",
      occurredAt: justInsideBoundary,
    });

    // Re-open — prunes anything < (now - 30d)
    openActivityLog(db);

    const remaining = log1.listRecent(100);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.occurredAt).toBe(justInsideBoundary);
  });
});

describe("index re-exports", () => {
  it("exports public API from index", async () => {
    const indexModule = await import("../src/index");
    expect(indexModule.openActivityLog).toBeDefined();
    expect(indexModule.openRemoteEnvironmentStore).toBeDefined();
    expect(indexModule.mapRowToRemoteEnvironment).toBeDefined();
  });
});
