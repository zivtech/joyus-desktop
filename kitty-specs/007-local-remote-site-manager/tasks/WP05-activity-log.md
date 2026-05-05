---
work_package_id: WP05
title: Activity Log
dependencies:
- WP04
requirement_refs:
- FR-018
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts for this feature were generated on main. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into main unless the human explicitly redirects the landing branch.
subtasks:
- T023
- T024
- T025
history:
- date: '2026-04-01'
  action: created
  by: spec-kitty.tasks
authoritative_surface: 'src/activityLog.ts'
execution_mode: code_change
mission_id: 01KPR4E967F61H0B7K24440QG5
owned_files:
- src/activityLog.ts
- test/activityLog.test.ts
tags: []
wp_code: WP05
---

# WP05: Activity Log

**Implement with**: `spec-kitty implement WP05 --base WP04`

## Objective

Implement the SQLite-backed activity log for internal users to troubleshoot the push/PR/environment pipeline. Shares the same database file as the remote environment store.

## Context

- **Same database**: Uses `~/.joyus/environment-monitor.db` — add `activity_log` table alongside `remote_environments`
- **Data model**: See `data-model.md` — `ActivityLogEntry` entity
- **Retention**: 30-day pruning on first access each app startup
- **Audience**: Internal users only (client users don't see this)

## Subtasks

### T023: Implement `activityLog.ts`

**Purpose**: SQLite table for event logging with append, query, and prune.

**Steps**:
1. Schema (in same DB as remote environment store):
   ```sql
   CREATE TABLE IF NOT EXISTS activity_log (
     id TEXT PRIMARY KEY,
     repo_owner TEXT,
     repo_name TEXT,
     event_type TEXT NOT NULL CHECK (event_type IN ('push','pr_created','env_building','env_ready','env_failed','env_expired','site_started','site_stopped','site_error','runtime_installed','error')),
     description TEXT NOT NULL,
     metadata TEXT,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS idx_activity_log_repo ON activity_log (repo_owner, repo_name, created_at DESC);
   CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log (created_at DESC);
   ```
2. Implement `openActivityLog(db: DatabaseSync)` factory (accepts existing DB connection):
   - `append(entry)`: INSERT with UUID + timestamp, metadata as `JSON.stringify`
   - `listRecent(limit)`: SELECT ordered by `created_at DESC` with LIMIT
   - `listByRepo(owner, name, limit)`: SELECT filtered by repo, ordered by `created_at DESC`
   - `pruneOlderThan(cutoffMs)`: DELETE WHERE `created_at < cutoffMs`, return count of deleted rows
   - `close()`: no-op (DB lifecycle managed by the store that owns the connection)
3. Parse `metadata` back from JSON string on read

**Files**: `packages/environment-monitor/src/activityLog.ts` (~80 lines)

### T024: Implement startup pruning

**Purpose**: Delete entries older than 30 days on first access.

**Steps**:
1. In the `openActivityLog` factory, immediately after table creation:
   ```typescript
   const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
   pruneStmt.run(thirtyDaysAgo);
   ```
2. This runs once per app startup (when the store is opened)

**Files**: `packages/environment-monitor/src/activityLog.ts` (within factory, ~3 lines)

### T025: Write tests for `activityLog.test.ts`

**Steps**:
1. Create in-memory `DatabaseSync`, pass to `openActivityLog`
2. Test `append()`: creates entry with UUID and timestamp; metadata serialized as JSON
3. Test `listRecent(limit)`: returns entries in reverse chronological order; respects limit
4. Test `listByRepo()`: filters by owner/name; ignores entries from other repos
5. Test `pruneOlderThan()`: deletes old entries, keeps recent ones, returns correct count
6. Test startup pruning: create entries with old timestamps, reopen log, verify they're gone
7. Test null metadata: entry without metadata stores/reads correctly
8. Test boundary: entry exactly at 30-day cutoff — should be kept (prune is strictly less-than)

**Files**: `packages/environment-monitor/test/activityLog.test.ts`

## Definition of Done

- [ ] `activity_log` table created in environment-monitor DB
- [ ] append, listRecent, listByRepo, pruneOlderThan all work correctly
- [ ] Startup pruning removes entries older than 30 days
- [ ] All tests pass, 100% coverage
- [ ] Exported from `index.ts`

## Risks

- **Shared DB connection**: The activity log receives an existing `DatabaseSync` instance from the remote environment store. Ensure the store creates both tables before handing off the connection.
