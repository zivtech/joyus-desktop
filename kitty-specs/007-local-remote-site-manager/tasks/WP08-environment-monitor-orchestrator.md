---
work_package_id: WP08
title: Environment Monitor Orchestrator
lane: planned
dependencies: [WP05, WP06, WP07]
requirement_refs: [FR-008, FR-009, FR-013]
planning_base_branch: claude/channels-spec-005-amendment
merge_target_branch: claude/channels-spec-005-amendment
branch_strategy: Planning artifacts for this feature were generated on claude/channels-spec-005-amendment. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into claude/channels-spec-005-amendment unless the human explicitly redirects the landing branch.
subtasks: [T038, T039, T040, T041, T042, T043]
history:
- date: '2026-04-01'
  action: created
  by: spec-kitty.tasks
---

# WP08: Environment Monitor Orchestrator

**Implement with**: `spec-kitty implement WP08 --base WP07`

## Objective

Implement the `EnvironmentMonitor` orchestrator that ties the environment-monitor package together: handles PR events from Feature 006, manages the polling lifecycle, surfaces environments, and logs activity.

## Context

- **Depends on**: WP04 (store), WP05 (activity log), WP06 (poller), WP07 (discovery + identity)
- **Contracts**: See `contracts/environment-monitor.ts` — `EnvironmentMonitor` interface
- **Event bridge**: Feature 006 will emit events; this WP implements the receiver side

## Subtasks

### T038: Implement `environmentMonitor.ts` — `onPrCreated()`

**Purpose**: Handle push+PR events from Feature 006 and initiate environment tracking.

**Steps**:
1. Implement `createEnvironmentMonitor(store, activityLog, poller, proboDetector, userIdentity)` factory
2. `onPrCreated(repoOwner, repoName, prNumber, taskBranchId)`:
   a. Check if repo has Probo (use `proboDetector` if repo is cloned locally; otherwise assume yes for remote repos)
   b. Create or update `RemoteEnvironment` in store:
      - `environmentType: 'probo'`
      - `status: 'building'`
      - `prNumber`, `taskBranchId`
      - Get PR title via `gh api repos/{owner}/{repo}/pulls/{number} --jq '.title'`
   c. Trigger immediate poll: `poller.triggerImmediatePoll(repoOwner, repoName, prNumber)`
   d. Log activity: `activityLog.append({ eventType: 'pr_created', description: 'Pull request created: [title]', ... })`

**Files**: `packages/environment-monitor/src/environmentMonitor.ts` (~50 lines)

### T039: Implement `requestHostedEnvironment()`

**Purpose**: Stub for joyus-ai hosted environment provisioning.

**Steps**:
1. `requestHostedEnvironment(repoOwner, repoName)`:
   - Create `RemoteEnvironment` in store with `environmentType: 'joyus-ai-hosted'`, `status: 'provisioning'`
   - Log activity: `eventType: 'env_building'`
   - Return the created record
   - Comment: "TODO: Call joyus-ai platform API to provision environment"
2. For now, the environment stays in `provisioning` status until the joyus-ai API is implemented

**Files**: `packages/environment-monitor/src/environmentMonitor.ts` (~20 lines)

### T040: Implement `start()` / `stop()`

**Purpose**: Manage the polling lifecycle.

**Steps**:
1. `start()`:
   - Call `poller.startPolling()`
   - Run initial sync: poll all `building` environments once
   - Log activity: `eventType: 'env_building'`, description: 'Environment monitor started'
2. `stop()`:
   - Call `poller.stopPolling()`
3. Track started/stopped state to prevent double-start

**Files**: `packages/environment-monitor/src/environmentMonitor.ts` (~20 lines)

### T041: Implement environment lifecycle management

**Purpose**: React to poller results — update store, transition states, log changes.

**Steps**:
1. After each poll cycle (register a callback on the poller or poll inline):
   - For each `DeploymentStatusResult`:
     a. Find or create `RemoteEnvironment` by `deploymentId`
     b. Map GitHub state to `RemoteEnvironmentStatus`
     c. If status changed from previous:
        - Update store with new status + `environmentUrl`
        - Log the transition: `env_ready`, `env_failed`, or `env_expired`
2. Handle expired environments:
   - If a `RemoteEnvironment` with status `ready` has no matching deployment in poll results, transition to `expired`
   - Log: `env_expired`
3. Update `lastCheckedAt` for all polled environments

**Files**: `packages/environment-monitor/src/environmentMonitor.ts` (~40 lines)

### T042: Implement `listAll()` and `listByRepo()`

**Purpose**: Query interface for the site manager panel.

**Steps**:
1. `listAll()`: delegate to `store.listAll()`
2. `listByRepo(owner, name)`: delegate to `store.listByRepo(owner, name)`
3. `getActivityLog()`: return the activity log instance
4. Filter by user type if needed (but this is the caller's responsibility per FR-010)

**Files**: `packages/environment-monitor/src/environmentMonitor.ts` (~10 lines)

### T043: Write tests for `environmentMonitor.test.ts`

**Steps**:
1. Mock all dependencies: store, activityLog, poller, proboDetector, userIdentity, execCommand
2. Test `onPrCreated()`:
   - Creates RemoteEnvironment in store with correct fields
   - Triggers immediate poll
   - Logs pr_created activity
3. Test `requestHostedEnvironment()`:
   - Creates record with status 'provisioning'
   - Logs activity
4. Test `start()`/`stop()`:
   - Starts/stops poller
   - Double-start prevented
5. Test lifecycle management:
   - Poll returns success → store updated to ready, activity logged
   - Poll returns failure → store updated to failed, activity logged
   - Previously ready env not in poll results → transitioned to expired
6. Test `listAll()` and `listByRepo()`: delegates to store correctly

**Files**: `packages/environment-monitor/test/environmentMonitor.test.ts`

## Definition of Done

- [ ] `onPrCreated()` handles Feature 006 events end-to-end
- [ ] `requestHostedEnvironment()` stub works for joyus-ai path
- [ ] Polling lifecycle managed correctly with start/stop
- [ ] State transitions logged to activity log
- [ ] All tests pass, 100% coverage
- [ ] `index.ts` exports complete public API for `@joyus/environment-monitor`

## Risks

- **Poller callback mechanism**: The poller from WP06 may need a callback/event pattern for the orchestrator to react to poll results. If the poller doesn't have this, the orchestrator can poll the store for changes on a timer — less elegant but functional.
