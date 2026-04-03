---
work_package_id: WP03
title: Local Site Store & Manager
lane: planned
dependencies: [WP01, WP02]
requirement_refs: [FR-003, FR-005, FR-014]
planning_base_branch: claude/channels-spec-005-amendment
merge_target_branch: claude/channels-spec-005-amendment
branch_strategy: Planning artifacts for this feature were generated on claude/channels-spec-005-amendment. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into claude/channels-spec-005-amendment unless the human explicitly redirects the landing branch.
subtasks: [T011, T012, T013, T014, T015, T016, T017]
history:
- date: '2026-04-01'
  action: created
  by: spec-kitty.tasks
---

# WP03: Local Site Store & Manager

**Implement with**: `spec-kitty implement WP03 --base WP02`

## Objective

Implement SQLite persistence for local sites and the `LocalSiteManager` orchestrator that provisions, manages lifecycle, and monitors DDEV sites. This completes the `local-provisioner` package.

## Context

- **SQLite patterns**: Follow `taskBranchStore.ts` — `DatabaseSync`, prepared statements, soft deletes, `mapRowTo*` pattern
- **Database path**: `~/.joyus/local-provisioner.db` (separate from other packages)
- **Data model**: See `kitty-specs/007-local-remote-site-manager/data-model.md` — `LocalSite` entity
- **Dependencies**: Uses `DdevCli` from WP02 and `DockerClient` from WP01

## Subtasks

### T011: Implement `localSiteStore.ts`

**Purpose**: SQLite CRUD for the `LocalSite` entity.

**Steps**:
1. Define schema:
   ```sql
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
   CREATE UNIQUE INDEX IF NOT EXISTS idx_local_sites_repo_path ON local_sites (repo_path) WHERE deleted_at IS NULL;
   CREATE INDEX IF NOT EXISTS idx_local_sites_status ON local_sites (status) WHERE deleted_at IS NULL;
   ```
2. Implement `openLocalSiteStore(dbPath?: string)` factory with prepared statements for:
   - `create()` — INSERT with UUID, timestamps
   - `findById()`, `findByRepoPath()` — SELECT with soft-delete filter
   - `listAll()` — SELECT ordered by `last_activity_at DESC`
   - `updateStatus(id, status, errorMessage?)` — UPDATE status + optional error
   - `updateUrls(id, httpUrl, httpsUrl)` — UPDATE URLs after ddev start
   - `updateActivity(id)` — UPDATE `last_activity_at` to now
   - `softDelete(id)` — SET `deleted_at`
   - `close()`

**Files**: `packages/local-provisioner/src/localSiteStore.ts` (~150 lines)

### T012: Implement `localSiteManager.ts` — provision flow

**Purpose**: Orchestrate the full site provisioning: clone → ddev start → persist.

**Steps**:
1. Implement `createLocalSiteManager(store, ddevCli, execCommand)` factory
2. `provision(input: CreateLocalSiteInput)`:
   a. Determine clone path: `input.clonePath ?? join(homedir(), '.joyus/sites', repoName)`
   b. Clone repo: `execCommand(['git', 'clone', input.repoUrl, clonePath])`
   c. Check for `.ddev/config.yaml` — if missing, throw with plain-language message
   d. Read DDEV project name from `.ddev/config.yaml` (parse YAML `name` field)
   e. Create `LocalSite` record in store with status `starting`
   f. Run `ddevCli.start(projectName)`
   g. Run `ddevCli.describe(projectName)` to get URLs
   h. Update store: status → `running`, set URLs
   i. On failure: update store status → `error` with classified error message
   j. Return the `LocalSite`

**Files**: `packages/local-provisioner/src/localSiteManager.ts` (~80 lines for provision)

### T013: Implement lifecycle methods

**Purpose**: Start, stop, restart, and remove existing sites.

**Steps**:
1. `start(siteId)`: find site → update status to `starting` → `ddevCli.start()` → `ddevCli.describe()` for URLs → update status to `running`
2. `stop(siteId)`: find site → `ddevCli.stop()` → update status to `stopped`
3. `restart(siteId)`: find site → `ddevCli.restart()` → `ddevCli.describe()` for URLs → update status to `running`
4. `remove(siteId, deleteRepo)`: find site → `ddevCli.stop()` → `ddevCli.delete()` → if `deleteRepo` then `rm -rf repoPath` → `store.softDelete(id)`
5. All methods: catch DdevError, update status to `error` with plain-language message

**Files**: `packages/local-provisioner/src/localSiteManager.ts` (~60 lines)

### T014: Implement `syncAll()`

**Purpose**: Refresh all site statuses from DDEV's actual state.

**Steps**:
1. Call `ddevCli.list()` to get all DDEV projects
2. For each `LocalSite` in store:
   - Find matching DDEV project by `ddev_project_name`
   - If found: update status from DDEV's reported status, update URLs
   - If not found and current status is `running`: update to `stopped` (DDEV project removed externally)
3. Update `last_activity_at` for any site whose status changed

**Files**: `packages/local-provisioner/src/localSiteManager.ts` (~30 lines)

### T015: Implement `getResourceUsage()`

**Purpose**: Return CPU/memory snapshot for a running site.

**Steps**:
1. Find site by ID → verify status is `running`
2. Delegate to `ddevCli.getContainerStats(site.ddevProjectName)` (from WP02 T008)
3. Return `ResourceSnapshot | undefined`

**Files**: `packages/local-provisioner/src/localSiteManager.ts` (~10 lines)

### T016: Write tests for `localSiteStore.test.ts`

**Steps**:
1. Use in-memory SQLite for isolation
2. Test create → findById → verify all fields
3. Test findByRepoPath — unique constraint, soft-delete filtered
4. Test listAll — ordered by last_activity_at, excludes soft-deleted
5. Test updateStatus — including error message
6. Test updateUrls — after ddev start
7. Test softDelete — excluded from subsequent queries
8. Test duplicate repo_path rejection (unique index)

**Files**: `packages/local-provisioner/test/localSiteStore.test.ts`

### T017: Write tests for `localSiteManager.test.ts`

**Steps**:
1. Mock `LocalSiteStore`, `DdevCli`, `ExecCommand`
2. Test `provision()`:
   - Happy path: clone → ddev start → describe → running
   - Missing .ddev config → error with "not configured" message
   - ddev start fails → status `error` with classified message
3. Test `start()`: stopped → starting → running; error handling
4. Test `stop()`: running → stopped
5. Test `restart()`: running → running with fresh URLs
6. Test `remove()`: with and without deleteRepo
7. Test `syncAll()`: status updated from DDEV list; externally removed project detected
8. Test `getResourceUsage()`: running → snapshot; stopped → undefined

**Files**: `packages/local-provisioner/test/localSiteManager.test.ts`

## Definition of Done

- [ ] `localSiteStore.ts` implements full CRUD with soft delete
- [ ] `localSiteManager.ts` handles provision, lifecycle, sync, and resource usage
- [ ] Provision flow works end-to-end: clone → ddev start → persist → return URL
- [ ] All error scenarios produce plain-language messages
- [ ] All tests pass, 100% coverage
- [ ] `index.ts` exports complete public API for `@joyus/local-provisioner`

## Risks

- **DDEV config parsing**: `.ddev/config.yaml` format is stable but we need to parse the `name` field. Use a simple regex or line scan rather than adding a YAML parser dependency.
- **Clone path conflicts**: If the repo was already cloned at the same path, `git clone` will fail. Check for existing directory and reuse if it contains the right remote.
