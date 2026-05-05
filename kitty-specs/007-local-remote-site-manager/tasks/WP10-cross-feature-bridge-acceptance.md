---
work_package_id: WP10
title: Cross-Feature Event Bridge & Acceptance
dependencies:
- WP03
- WP09
requirement_refs:
- FR-004
- FR-010
- FR-011
- FR-016
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts for this feature were generated on main. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into main unless the human explicitly redirects the landing branch.
subtasks:
- T050
- T051
- T052
- T053
- T054
- T055
- T056
history:
- date: '2026-04-01'
  action: created
  by: spec-kitty.tasks
authoritative_surface: 'src/unifiedSiteList.ts'
execution_mode: code_change
mission_id: 01KPR4E967F61H0B7K24440QG5
owned_files:
- src/unifiedSiteList.ts
- test/integration.test.ts
tags: []
wp_code: WP10
---

# WP10: Cross-Feature Event Bridge & Acceptance

**Implement with**: `spec-kitty implement WP10 --base WP09`

## Objective

Wire session-manager events to environment-monitor, implement the unified site panel data model, and validate all end-to-end flows including edge cases. This completes Feature 007.

## Context

- **Event source**: `session-manager` emits `pr-created` events (from WP09)
- **Event consumer**: `environment-monitor` receives via `onPrCreated()` (from WP08)
- **FR-010**: User-type filtering (internal sees all, client sees remote only)
- **FR-016**: Auto-linking — session close → push → PR → Probo → site manager
- **This is the integration + acceptance WP** — validates the full feature works end-to-end

## Subtasks

### T050: Implement event bridge

**Purpose**: Connect session-manager's `pr-created` event to environment-monitor's `onPrCreated()`.

**Steps**:
1. Create a bridge module (likely in `apps/desktop-companion` or a shared orchestration layer):
   ```typescript
   export function wireSessionToEnvironment(
     sessionEvents: SessionEvents,
     environmentMonitor: EnvironmentMonitor,
   ): void {
     sessionEvents.on('pr-created', (data) => {
       environmentMonitor.onPrCreated(
         data.repoOwner,
         data.repoName,
         data.prNumber,
         data.taskBranchId,
       );
     });
   }
   ```
2. Determine the right location for this bridge:
   - If `apps/desktop-companion` exists and orchestrates packages → put it there
   - If no app layer yet → create a minimal `packages/site-bridge` or put in environment-monitor as an optional wiring function
3. The bridge is thin glue — no business logic, just event routing

**Files**: Location TBD based on existing app structure (~20 lines)

### T051: Implement unified site list

**Purpose**: Combine local and remote environments into a single view model for the site panel.

**Steps**:
1. Define unified view model:
   ```typescript
   export interface ManagedSiteView {
     readonly id: string;
     readonly projectName: string;
     readonly environmentType: 'local' | 'probo' | 'joyus-ai-hosted';
     readonly status: string;
     readonly accessUrl: string | undefined;
     readonly prTitle: string | undefined;
     readonly prUrl: string | undefined;
     readonly lastActivity: number;
     readonly source: 'local-provisioner' | 'environment-monitor';
   }
   ```
2. Create `buildUnifiedSiteList(localSites, remoteEnvironments)`:
   - Map `LocalSite[]` → `ManagedSiteView[]` (source: local-provisioner)
   - Map `RemoteEnvironment[]` → `ManagedSiteView[]` (source: environment-monitor)
   - Combine and sort by `lastActivity` descending
3. Pure function — no side effects, easy to test

**Files**: `packages/environment-monitor/src/unifiedSiteList.ts` (~40 lines)

### T052: Implement user-type filtering

**Purpose**: Internal users see everything; client users see only remote environments.

**Steps**:
1. Create `filterByUserType(sites: ManagedSiteView[], userType: UserType)`:
   - If `userType === 'internal'`: return all sites
   - If `userType === 'client'`: return only sites where `environmentType !== 'local'`
2. Pure function, used by the panel/UI layer

**Files**: `packages/environment-monitor/src/unifiedSiteList.ts` (~10 lines, same file)

### T053: Implement offline handling

**Purpose**: Local sites work offline; remote status cached with timestamps.

**Steps**:
1. In `environmentMonitor.ts`:
   - When poller fails due to network error: don't update store status, keep last-known state
   - Update `lastCheckedAt` to indicate when the last successful check was
   - The UI layer can show "Last checked: [timestamp]" when offline
2. In `localSiteManager.ts`:
   - `syncAll()` uses `ddev list -j` which works offline (local Docker)
   - No changes needed — local sites are inherently offline-capable
3. Test: simulate network failure during poll → status unchanged, lastCheckedAt not updated

**Files**: `packages/environment-monitor/src/environmentMonitor.ts` (~10 lines), `packages/environment-monitor/src/deploymentStatusPoller.ts` (~5 lines)

### T054: Write end-to-end integration tests

**Purpose**: Validate the full flow: session close → push → PR → poll → environment appears.

**Steps**:
1. Test the complete pipeline with all dependencies mocked at the CLI boundary:
   a. Create a TaskBranch in session-manager store
   b. Call `sessionCloser.closeSession()` with mock git/gh commands returning success
   c. Verify `push-complete` event fired
   d. Verify `pr-created` event fired
   e. Verify environment-monitor received the event via bridge
   f. Mock `gh api` deployment status response with `state: 'success'` and `environment_url`
   g. Trigger poll
   h. Verify RemoteEnvironment in store has status `ready` and URL
   i. Verify activity log has entries for: pr_created, env_building, env_ready
2. Test the unified site list includes the new environment
3. Test user-type filtering removes local sites for client users

**Files**: New test file in appropriate location (e.g., `packages/environment-monitor/test/integration.test.ts`)

### T055: Write edge case tests

**Purpose**: Validate error scenarios and boundary conditions.

**Steps**:
1. **Port conflict**: mock `ddev start` failing with port-in-use → LocalSite status `error`, message includes suggestion
2. **Network failure during push**: mock git push failing → session closer returns retryable error, no PR created
3. **Rate limiting**: mock `gh api` returning 403 → poller backs off, status unchanged
4. **Missing .probo.yaml**: repo without Probo config → no Probo environment created, joyus-ai fallback available
5. **Missing .ddev config**: repo without `.ddev/` → provision fails with "not configured" message
6. **PR already exists**: `gh pr list` returns existing PR → no duplicate created
7. **Environment expires**: poll returns `inactive` → status transitions to `expired`, URL removed
8. **Concurrent polls**: two poll ticks overlap → second skipped
9. **Docker not running**: `/_ping` connection refused → `dockerRunning: false`, site provisioning blocked with clear message

**Files**: Distributed across relevant test files

### T056: Export public API from both packages

**Purpose**: Ensure both packages have clean, complete exports.

**Steps**:
1. `packages/local-provisioner/src/index.ts`:
   ```typescript
   export * from './dockerClient.js';
   export * from './runtimeDetector.js';
   export * from './ddevCli.js';
   export * from './localSiteStore.js';
   export * from './localSiteManager.js';
   ```
2. `packages/environment-monitor/src/index.ts`:
   ```typescript
   export * from './proboDetector.js';
   export * from './remoteEnvironmentStore.js';
   export * from './activityLog.js';
   export * from './deploymentStatusPoller.js';
   export * from './userIdentity.js';
   export * from './projectDiscovery.js';
   export * from './environmentMonitor.js';
   export * from './unifiedSiteList.js';
   ```
3. Verify `pnpm typecheck` passes with all exports
4. Verify `pnpm coverage` passes at 100% across both packages

**Files**: `packages/local-provisioner/src/index.ts`, `packages/environment-monitor/src/index.ts`

## Definition of Done

- [ ] Event bridge wires session-manager → environment-monitor
- [ ] Unified site list combines local + remote environments
- [ ] User-type filtering works correctly (internal vs. client)
- [ ] Offline handling: remote status cached, local sites unaffected
- [ ] End-to-end integration test passes the full pipeline
- [ ] All 9 edge case scenarios tested and handled
- [ ] Both packages export complete public API
- [ ] `pnpm typecheck` passes
- [ ] `pnpm coverage` passes at 100%

## Risks

- **Event bridge location**: Depends on whether `apps/desktop-companion` is the right orchestration layer. If unclear, use a standalone function exported from environment-monitor.
- **Test isolation**: Integration tests mock at the CLI boundary (git, gh, ddev) but use real SQLite. Ensure test databases are isolated per test case.

## Activity Log

- 2026-05-05T01:48:11Z – unknown – Pre-existing implementation on main — code verified, 360 tests passing
