---
work_package_id: WP05
title: Sync, Skills & Governance IPC
dependencies: []
subtasks: [T021, T022, T023, T024, T025]
history:
- date: '2026-03-14'
  event: created
  note: Generated from spec-kitty.tasks
authoritative_surface: ''
execution_mode: code_change
mission_id: 01KPR4E967F61H0B7K24440QG2
owned_files:
- src/sidecar/main.ts
- src/sidecar/services.ts
- src/sidecar/skill-scanner.ts
- test/sidecar/sync-governance.test.ts
wp_code: WP05
---

# WP05 — Sync, Skills & Governance IPC

**Objective**: Implement sidecar IPC methods for skill sync management, skill listing, governance mode/decisions, and state change notifications including error reporting.

**Implementation command**: `spec-kitty implement WP05 --base WP03`

## Context

The `desktop-sync` package handles git-based skill sync, and `mcp-governance` handles governance mode enforcement. This WP exposes both through the sidecar's JSON-RPC interface.

---

## Subtask T021: Sync & Skills IPC Methods

**Purpose**: Expose sync control and skill listing via JSON-RPC.

**Steps**:
1. Register IPC handlers:
   - `sync.trigger`: call `startupSync(config, deps)`, return `SyncResult`
   - `sync.status`: return current sync state (idle/syncing/synced/error, version, timestamp)
   - `skills.list`: read synced skills directory, return `SkillInfo[]` (name, version, bundle, path)
2. For `skills.list`: scan the skills destination directory, parse each skill's metadata to extract name/version
3. Maintain sync state in the service container (updated by periodic sync and manual triggers)

**Files**:
- Update `apps/desktop-companion/src/sidecar/services.ts` (~50 lines)
- Create `apps/desktop-companion/src/sidecar/skill-scanner.ts` (new, ~40 lines)

**Validation**:
- [ ] `sync.trigger` initiates a sync and returns result
- [ ] `sync.status` returns current state
- [ ] `skills.list` returns all synced skills with metadata

---

## Subtask T022: Governance IPC Methods

**Purpose**: Expose governance mode and recent decisions via JSON-RPC.

**Steps**:
1. Register IPC handlers:
   - `governance.getMode`: read current governance config, return `{ mode: "off" | "audit" | "enforce" }`
   - `governance.getDecisions`: query in-memory decision log (maintained by mcp-governance middleware), return `GovernanceDecision[]` with optional limit param
2. The governance config poller (`createConfigPoller`) is already running in the service container — expose its cached state

**Files**:
- Update `apps/desktop-companion/src/sidecar/services.ts` (~30 lines)

**Validation**:
- [ ] `governance.getMode` returns current mode
- [ ] `governance.getDecisions` returns recent decisions with correct schema

---

## Subtask T023: Sync & Governance Notifications

**Purpose**: Push sync completion and governance decision events to Rust backend.

**Steps**:
1. After each sync (periodic or manual), emit `state.syncCompleted` notification:
   ```json
   { "version": "1.2.0", "fromCache": false, "durationMs": 3200 }
   ```
2. Hook into mcp-governance middleware to emit `state.governanceDecision` after each tool call:
   ```json
   { "toolName": "jira_create_issue", "serverName": "atlassian", "decision": "allow", "mode": "audit" }
   ```
3. Use `sendNotification` from ipc-handler

**Files**:
- Update `apps/desktop-companion/src/sidecar/services.ts` (~30 lines)

**Validation**:
- [ ] Sync completion triggers notification on stdout
- [ ] Governance decisions trigger notifications

---

## Subtask T024: Error Notifications & Crash Reporting

**Purpose**: Report sidecar errors through telemetry and as notifications.

**Steps**:
1. Implement `state.error` notification for non-fatal errors:
   - `{ source: string, message: string, fatal: boolean }`
2. For crash reporting (FR-021): when a critical error occurs, call `emitToolCallEvent` from `mcp-governance` telemetry emitter with event type `"app_error"` (extending the existing telemetry pipeline)
3. Respect telemetry opt-out: check before emitting
4. Install global `process.on("uncaughtException")` and `process.on("unhandledRejection")` handlers that:
   - Emit `state.error` notification with `fatal: true`
   - Emit telemetry event
   - Log to stderr
   - Exit gracefully

**Files**:
- Update `apps/desktop-companion/src/sidecar/main.ts` (~25 lines)
- Update `apps/desktop-companion/src/sidecar/services.ts` (~15 lines)

**Validation**:
- [ ] Non-fatal errors emit `state.error` notification
- [ ] Fatal errors emit notification, telemetry, and exit
- [ ] Telemetry respects opt-out setting

---

## Subtask T025: Tests for Sync/Skills/Governance IPC

**Purpose**: 100% coverage for sync, skills, and governance IPC methods.

**Steps**:
1. Create `apps/desktop-companion/test/sidecar/sync-governance.test.ts`:
   - Test `sync.trigger` with mock desktop-sync
   - Test `sync.status` returns correct state
   - Test `skills.list` with mock skill directory
   - Test `governance.getMode` returns current mode
   - Test `governance.getDecisions` with limit parameter
   - Test sync notification emission
   - Test governance decision notification emission
   - Test error notification and crash reporting paths
   - Test telemetry opt-out disables crash reporting

**Files**:
- `apps/desktop-companion/test/sidecar/sync-governance.test.ts` (new, ~180 lines)

**Validation**:
- [ ] All tests pass with 100% branch coverage

---

## Definition of Done

- [ ] All sync, skills, governance IPC methods work correctly
- [ ] Notifications emit on sync completion and governance decisions
- [ ] Error/crash reporting works through telemetry pipeline
- [ ] 100% test coverage
- [ ] `pnpm typecheck` passes

## Activity Log

- 2026-03-14T22:51:50Z – agent-wp05 – shell_pid=66406 – lane=doing – Started implementation via workflow command
- 2026-03-14T23:17:52Z – agent-wp05 – shell_pid=66406 – lane=done – Complete
