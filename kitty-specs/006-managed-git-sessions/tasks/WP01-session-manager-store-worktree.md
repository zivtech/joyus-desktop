---
work_package_id: WP01
title: 'session-manager: Store & Worktree Operations'
lane: "doing"
dependencies: []
base_branch: main
base_commit: c93ca06c8b87d6f6c0a31b1168de96e1c9216dbf
created_at: '2026-03-20T01:26:31.973491+00:00'
subtasks: [T001, T002, T003, T004, T005, T006, T007, T008]
shell_pid: "41754"
history:
- date: '2026-03-19'
  event: created
---

# WP01 — session-manager: Store & Worktree Operations

**Feature**: 006 — Managed Git Sessions
**Priority**: P0 (blocks WP02, WP04)
**Implement with**: `spec-kitty implement WP01`

## Objective

Create `packages/session-manager` — the SQLite-backed persistence layer for `TaskBranch` records and the git worktree lifecycle manager. This package is the foundation of the entire feature. Nothing else can be built until it exists.

## Context

**New package**: `packages/session-manager`
**Pattern to follow**: `packages/policy-client` (SQLite with `node:sqlite`, injectable deps, ESM, 100% coverage)
**Key reference file**: `packages/policy-client/src/replayCache.ts` — follow its `openReplayCache()` factory pattern, `tmpdir` test pattern, and typed-row approach.
**Contract file**: `kitty-specs/006-managed-git-sessions/contracts/session-manager.ts` — implement these interfaces exactly.
**Data model**: `kitty-specs/006-managed-git-sessions/data-model.md` — use the SQL schema verbatim.

The `ExecGit` injection signature matches `packages/desktop-sync/src/types.ts`:
```typescript
type ExecGit = (args: string[], cwd?: string) => Promise<{ stdout: string; stderr: string }>
```

All worktree operations use `execGit` — never spawn `child_process` directly.

## Subtasks

### T001 — Package Scaffold

**Purpose**: Create the `packages/session-manager` package with correct monorepo configuration.

**Steps**:

1. Create `packages/session-manager/package.json`:
```json
{
  "name": "@joyus/session-manager",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "coverage": "vitest run --coverage"
  }
}
```

2. Create `packages/session-manager/tsconfig.json` — copy from `packages/policy-client/tsconfig.json` (same strict settings: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, ES2022, ESM).

3. Create `packages/session-manager/src/index.ts` (empty for now — exports added as modules are built).

4. Create `packages/session-manager/test/` directory.

5. Add `@joyus/session-manager` to `apps/desktop-companion/package.json` dependencies and to the root `pnpm-workspace.yaml` if not auto-discovered.

**Files**: `packages/session-manager/package.json`, `packages/session-manager/tsconfig.json`, `packages/session-manager/src/index.ts`

**Validation**:
- [ ] `pnpm typecheck` passes from package root
- [ ] Package is resolvable as `@joyus/session-manager` from `apps/desktop-companion`

---

### T002 — SQLite Schema and `openTaskBranchStore()` Factory

**Purpose**: Create the SQLite database with the TaskBranch schema and the injectable factory that opens it.

**Steps**:

1. Create `packages/session-manager/src/taskBranchStore.ts`.

2. Implement schema creation using `node:sqlite`:
```typescript
import { DatabaseSync } from 'node:sqlite';

const CREATE_TABLE = `
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
  CREATE UNIQUE INDEX IF NOT EXISTS idx_tb_session_id
    ON task_branches (session_id) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_tb_repo_path ON task_branches (repo_path);
  CREATE INDEX IF NOT EXISTS idx_tb_status ON task_branches (status) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_tb_last_activity ON task_branches (last_activity_at) WHERE deleted_at IS NULL;
`;
```

3. Implement `openTaskBranchStore(dbPath?: string): TaskBranchStore`:
   - `dbPath` defaults to `~/.joyus/session-manager.db` (use `node:os` `homedir()`)
   - Open with `new DatabaseSync(dbPath)`
   - Run schema creation
   - Return the store implementation

**exactOptionalPropertyTypes note**: `dbPath !== undefined ? { dbPath } : {}` pattern when passing to deps.

**Files**: `packages/session-manager/src/taskBranchStore.ts`

**Validation**:
- [ ] Schema created idempotently (IF NOT EXISTS)
- [ ] `openTaskBranchStore()` works with no args (uses default path)
- [ ] `openTaskBranchStore('/tmp/test.db')` works for tests

---

### T003 — `TaskBranchStore` CRUD Methods

**Purpose**: Implement create, read, and list operations on the TaskBranch store.

**Steps**:

1. Implement `create(input)`:
   - Generate UUID v4 for `id` (use `crypto.randomUUID()`)
   - Insert full row; return typed `TaskBranch`
   - Typed row helper: cast result `as unknown as StoredRow` (matching `replayCache.ts` pattern for `node:sqlite` type gap)

2. Implement `findBySessionId(sessionId)`:
   - `SELECT ... WHERE session_id = ? AND deleted_at IS NULL`
   - Return `TaskBranch | undefined`

3. Implement `listAll()`:
   - `SELECT ... WHERE deleted_at IS NULL ORDER BY last_activity_at DESC`
   - Return `readonly TaskBranch[]`

4. Export `mapRowToTaskBranch(row: StoredRow): TaskBranch` as a testable helper.

**Files**: `packages/session-manager/src/taskBranchStore.ts`

**Validation**:
- [ ] `create` → `findBySessionId` round-trip returns identical record
- [ ] `listAll` orders by `last_activity_at` DESC
- [ ] `findBySessionId` returns `undefined` for missing session
- [ ] `findBySessionId` returns `undefined` for soft-deleted session

---

### T004 — `TaskBranchStore` State Transition Methods

**Purpose**: Implement status updates, soft delete, stale threshold application, and merged detection.

**Steps**:

1. `updateStatus(id, status)`: `UPDATE task_branches SET status = ? WHERE id = ?`

2. `updateActivity(input)`: `UPDATE task_branches SET last_activity_at = ? WHERE id = ?`

3. `softDelete(id)`: `UPDATE task_branches SET deleted_at = ? WHERE id = ?` (use `Date.now()`)

4. `applyStaleThreshold(staleBefore: number)`:
   - `UPDATE task_branches SET status = 'stale' WHERE status = 'active' AND last_activity_at < ? AND deleted_at IS NULL`
   - `staleBefore` is a Unix ms timestamp (e.g., `Date.now() - 14 * 24 * 60 * 60 * 1000`)

5. `detectMerged(execGit)`:
   - List all non-deleted `active` and `stale` task branches
   - For each, run: `execGit(['branch', '--merged', 'HEAD'], repoPath)`
   - If `branchName` appears in stdout, call `updateStatus(id, 'merged')`
   - Errors from `execGit` must not throw — log and continue

**Files**: `packages/session-manager/src/taskBranchStore.ts`

**Validation**:
- [ ] `updateStatus` transitions status correctly
- [ ] `softDelete` sets `deleted_at`; `listAll` excludes soft-deleted
- [ ] `applyStaleThreshold` only transitions `active` → `stale`, not `broken` or `merged`
- [ ] `detectMerged` skips repos where `execGit` throws

---

### T005 — `WorktreeManager`

**Purpose**: Implement git worktree create, remove, health-check, and list via `execGit` injection.

**Steps**:

1. Create `packages/session-manager/src/worktreeManager.ts`.

2. Implement `createWorktree({ repoPath, missionSlug, sessionDate })`:
   - Branch name pattern: `joyus/${sessionDate}-${missionSlug}` (e.g., `joyus/2026-03-19-update-homepage`)
   - Worktree path: `${repoPath}/.joyus-worktrees/${sessionDate}-${missionSlug}`
   - Run: `execGit(['worktree', 'add', '-b', branchName, worktreePath], repoPath)`
   - On name collision (exit code non-zero, stderr contains "already exists"): append `-2`, `-3`, etc. and retry (max 10)
   - Return `{ worktreePath, branchName }`

3. Implement `removeWorktree(worktreePath)`:
   - Run: `execGit(['worktree', 'remove', '--force', worktreePath])`
   - If worktree doesn't exist, treat as success (idempotent)

4. Implement `isWorktreeHealthy(worktreePath, repoPath)`:
   - Run: `execGit(['worktree', 'list', '--porcelain'], repoPath)`
   - Return `true` if `worktreePath` appears in stdout

5. Implement `listWorktrees(repoPath)`:
   - Parse `git worktree list --porcelain` output
   - Return paths as `readonly string[]`

**Files**: `packages/session-manager/src/worktreeManager.ts`

**Validation**:
- [ ] Create returns correct `{ worktreePath, branchName }`
- [ ] Name collision resolved by appending counter
- [ ] `removeWorktree` is idempotent (missing worktree doesn't throw)
- [ ] `isWorktreeHealthy` returns `false` for absent path

---

### T006 — `missionInferrer`

**Purpose**: Auto-infer a human-readable mission label from the file paths observed in a session's early context.

**Steps**:

1. Create `packages/session-manager/src/missionInferrer.ts`.

2. Implement `inferMissionLabel(filePaths: readonly string[]): string`:
   - Extract top-level directory names from paths (relative to repo root)
   - Take the most frequently occurring directory name
   - Slugify: lowercase, replace spaces/underscores with hyphens, truncate at 40 chars
   - If no paths: return `"session"` as fallback
   - Format: `YYYY-MM-DD-<slug>` using current date

3. Implement `slugify(label: string): string` as a testable export.

**Files**: `packages/session-manager/src/missionInferrer.ts`

**Validation**:
- [ ] `inferMissionLabel([])` returns `"session"` fallback (with date prefix)
- [ ] Most frequent directory is preferred
- [ ] Result is lowercase and hyphenated
- [ ] Result is ≤ 40 chars (excluding date prefix)

---

### T007 — Startup Integrity Scan

**Purpose**: Implement `scanIntegrity()` — on startup, verify all persisted TaskBranch worktrees exist on disk and mark broken ones.

**Steps**:

1. Add `scanIntegrity(execGit: ExecGit)` to `TaskBranchStore`:
   - `SELECT id, worktree_path, repo_path FROM task_branches WHERE status != 'broken' AND deleted_at IS NULL`
   - For each row: call `isWorktreeHealthy(worktreePath, repoPath)`
   - If not healthy: call `updateStatus(id, 'broken')`

2. Expose `scanIntegrity` in the `SessionManager.initialize()` method (implemented in WP02).

**Files**: `packages/session-manager/src/taskBranchStore.ts`

**Validation**:
- [ ] Missing worktree path → status set to `"broken"`
- [ ] Healthy worktree → status unchanged
- [ ] `broken` records skipped (idempotent)

---

### T008 — Unit Tests

**Purpose**: 100% coverage for all WP01 modules.

**Test file**: `packages/session-manager/test/taskBranchStore.test.ts`, `packages/session-manager/test/worktreeManager.test.ts`, `packages/session-manager/test/missionInferrer.test.ts`

**Test patterns**:
- Use real SQLite with `tmpdir()` — follow `packages/policy-client/test/replayCache.test.ts` pattern
- `execGit` injected as `vi.fn()` returning fixture `{ stdout, stderr }` strings
- `afterEach`: close db, delete tmpdir

**Key test cases**:
```
taskBranchStore:
  - create + findBySessionId round-trip
  - listAll excludes soft-deleted, orders by last_activity_at DESC
  - applyStaleThreshold: active → stale at threshold; merged/broken unaffected
  - detectMerged: branch in git output → merged; execGit throws → no crash
  - scanIntegrity: missing worktree → broken; healthy → unchanged

worktreeManager:
  - create: correct branch name pattern
  - create: collision → counter appended
  - removeWorktree: missing path → no throw
  - isWorktreeHealthy: present path → true; absent → false

missionInferrer:
  - empty paths → fallback slug
  - most frequent directory wins
  - result is slugified and date-prefixed
```

**Validation**:
- [ ] `pnpm coverage` at 100% for all WP01 source files
- [ ] `pnpm typecheck` passes

## Definition of Done

- [ ] `packages/session-manager` package created and resolvable in workspace
- [ ] All source files: `taskBranchStore.ts`, `worktreeManager.ts`, `missionInferrer.ts`, `index.ts`
- [ ] All test files created with 100% coverage
- [ ] `pnpm typecheck` passes
- [ ] `pnpm coverage` passes at 100%
- [ ] Public API exported from `src/index.ts`: `openTaskBranchStore`, `WorktreeManager`, `inferMissionLabel`, `slugify`

## Risks

- **`node:sqlite` type gap**: Cast result rows as `as unknown as StoredRow` (existing pattern in `replayCache.ts`).
- **`exactOptionalPropertyTypes`**: Never assign `undefined` to optional fields directly; use conditional spreads.
- **`git worktree add` stderr on name collision**: The exact stderr message varies across git versions. Use `exit code !== 0` as the primary collision signal, not stderr parsing.
- **`~/.joyus/` directory**: Must be created with `mkdirSync({ recursive: true })` before opening the DB file.

## Activity Log

- 2026-03-19T00:00:00Z – spec-kitty – lane=planned – Work package created
