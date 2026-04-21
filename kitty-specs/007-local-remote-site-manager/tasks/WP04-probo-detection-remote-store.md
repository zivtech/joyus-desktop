---
work_package_id: WP04
title: Probo Detection & Remote Environment Store
dependencies: []
requirement_refs: [FR-007]
planning_base_branch: claude/channels-spec-005-amendment
merge_target_branch: claude/channels-spec-005-amendment
branch_strategy: Planning artifacts for this feature were generated on claude/channels-spec-005-amendment. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into claude/channels-spec-005-amendment unless the human explicitly redirects the landing branch.
subtasks: [T018, T019, T020, T021, T022]
history:
- date: '2026-04-01'
  action: created
  by: spec-kitty.tasks
authoritative_surface: ''
execution_mode: code_change
mission_id: 01KPR4E967F61H0B7K24440QG5
owned_files:
- kitty-specs/007-local-remote-site-manager/contracts/environment-monitor.ts
- kitty-specs/007-local-remote-site-manager/data-model.md
- src/index.ts
- src/proboDetector.ts
- src/remoteEnvironmentStore.ts
- test/proboDetector.test.ts
- test/remoteEnvironmentStore.test.ts
wp_code: WP04
---

# WP04: Probo Detection & Remote Environment Store

**Implement with**: `spec-kitty implement WP04`

## Objective

Scaffold `packages/environment-monitor` and implement Probo detection + SQLite persistence for remote environments. This is the foundation for all remote environment tracking — parallel with the local-provisioner track.

## Context

- **Monorepo pattern**: Same conventions as `packages/session-manager` and `packages/local-provisioner`
- **SQLite**: Separate database file at `~/.joyus/environment-monitor.db` (not shared with session-manager or local-provisioner)
- **Contracts**: See `kitty-specs/007-local-remote-site-manager/contracts/environment-monitor.ts`
- **Data model**: See `kitty-specs/007-local-remote-site-manager/data-model.md` for schema

## Subtasks

### T018: Scaffold `packages/environment-monitor`

**Purpose**: Create the package structure.

**Steps**:
1. Create `packages/environment-monitor/package.json`:
   ```json
   {
     "name": "@joyus/environment-monitor",
     "private": true,
     "version": "0.1.0",
     "type": "module",
     "exports": { ".": "./src/index.ts" }
   }
   ```
2. Create `packages/environment-monitor/src/index.ts` — empty initially
3. Verify `pnpm install` and `pnpm typecheck` pass

**Files**: `packages/environment-monitor/package.json`, `packages/environment-monitor/src/index.ts`

### T019: Implement `proboDetector.ts`

**Purpose**: Detect whether a repository has Probo enabled by checking for `.probo.yaml`.

**Steps**:
1. Implement `createProboDetector()` factory:
   ```typescript
   export function createProboDetector(): ProboDetector {
     return {
       hasProbo(repoPath: string): boolean {
         return existsSync(join(repoPath, '.probo.yaml'));
       }
     };
   }
   ```
2. Check for both `.probo.yaml` and `.probo.yml` (YAML extensions vary)
3. Return `false` if the path doesn't exist or isn't a directory

**Files**: `packages/environment-monitor/src/proboDetector.ts` (~20 lines)

### T020: Implement `remoteEnvironmentStore.ts`

**Purpose**: SQLite persistence for remote environments following `taskBranchStore.ts` patterns.

**Steps**:
1. Define schema matching `data-model.md` — `remote_environments` table with all columns, constraints, and indexes
2. Implement `openRemoteEnvironmentStore(dbPath?: string)` factory:
   - Default path: `${homedir()}/.joyus/environment-monitor.db`
   - `upsertFromDeployment()`: INSERT or UPDATE by `deployment_id` — idempotent for poll-based updates
   - `findById()`, `findByDeploymentId()`, `findByTaskBranchId()`
   - `listByRepo(owner, name)`, `listAll()` — both exclude soft-deleted, ordered by `last_checked_at DESC`
   - `updateStatus(id, status, environmentUrl?)` — status transition + optional URL update
   - `updateLastChecked(id)` — timestamp update for poll tracking
   - `softDelete(id)` — set `deleted_at`
   - `close()` — close DB connection
3. Map rows to readonly `RemoteEnvironment` interface (same pattern as `mapRowToTaskBranch`)
4. Use prepared statements for all queries

**Files**: `packages/environment-monitor/src/remoteEnvironmentStore.ts` (~180 lines)

### T021: Write tests for `proboDetector.test.ts`

**Steps**:
1. Create temp directory with `.probo.yaml` → `hasProbo` returns true
2. Create temp directory without `.probo.yaml` → returns false
3. Non-existent path → returns false
4. Test `.probo.yml` variant

**Files**: `packages/environment-monitor/test/proboDetector.test.ts`

### T022: Write tests for `remoteEnvironmentStore.test.ts`

**Steps**:
1. Use in-memory SQLite (`:memory:`) for test isolation
2. Test CRUD operations: create, find by various keys, list, update status, soft delete
3. Test `upsertFromDeployment` idempotency — same deployment_id updates rather than duplicates
4. Test status transitions: building→ready, building→failed, ready→expired
5. Test `listByRepo` filtering and sort order
6. Test `updateLastChecked` timestamp updates

**Files**: `packages/environment-monitor/test/remoteEnvironmentStore.test.ts`

## Definition of Done

- [ ] `packages/environment-monitor` exists with correct package.json
- [ ] `pnpm typecheck` passes
- [ ] `proboDetector.ts` detects `.probo.yaml`/`.probo.yml`
- [ ] `remoteEnvironmentStore.ts` implements full CRUD with upsert
- [ ] All tests pass, 100% coverage on both files
- [ ] `index.ts` exports all public types and factory functions

## Risks

- **SQLite in-memory for tests**: Ensure `DatabaseSync` supports `:memory:` path (it does in Node 22+; verify in this project's Node version)
