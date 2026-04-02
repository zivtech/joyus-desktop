---
work_package_id: WP06
title: Usage Data Collection & Storage
lane: done
dependencies: []
subtasks: [T026, T027, T028, T029, T030]
agent: agent-wp06
shell_pid: '66406'
review_status: approved
reviewed_by: Alex Urevick-Ackelsberg
history:
- date: '2026-03-14'
  event: created
  note: Generated from spec-kitty.tasks
---

# WP06 — Usage Data Collection & Storage

**Objective**: Implement local usage data collection, query/summary IPC methods, 30-day data pruning, and the onboarding IPC method.

**Implementation command**: `spec-kitty implement WP06 --base WP03`

## Context

Usage data is stored in the local SQLite database (schema from WP01). The usage collector intercepts events from MCP tool calls, syncs, and governance decisions, writing them to the `usage_events` table. The dashboard queries this data via IPC methods.

Note: SQLite is accessed via Tauri commands from the Rust side. The sidecar sends usage events to Rust via notifications, and Rust writes them to SQLite. Query methods also proxy through Rust.

---

## Subtask T026: Implement Usage Collector

**Purpose**: Collect and record usage events from MCP tool calls, syncs, and governance decisions.

**Steps**:
1. Create `apps/desktop-companion/src/sidecar/usage-collector.ts`:
   - `recordEvent(event: UsageEvent)`: sends a `usage.record` notification to Rust (which writes to SQLite)
   - Hook into mcp-governance middleware `onToolCall` callback
   - Hook into sync completion events
   - Hook into server state changes
2. Each event includes: `eventType`, `source`, `action`, `outcome`, `durationMs`, `metadata`, `createdAt` (ISO 8601)
3. On the Rust side, add a handler for `usage.record` notification that INSERT into `usage_events` table

**Files**:
- `apps/desktop-companion/src/sidecar/usage-collector.ts` (new, ~60 lines)
- Update `apps/desktop-companion/src-tauri/src/sidecar.rs` (add usage.record handler, ~20 lines)

**Validation**:
- [ ] MCP tool calls generate usage events in SQLite
- [ ] Sync events are recorded
- [ ] Events have correct schema

---

## Subtask T027: Implement Usage Query IPC Methods

**Purpose**: Expose usage data to the dashboard via JSON-RPC.

**Steps**:
1. Implement Rust-side Tauri commands (since SQLite is in Rust):
   - `query_usage(params)`: SELECT from `usage_events` with optional filters (eventType, source, since, limit)
   - `get_usage_summary(days)`: aggregate query returning `UsageSummary`:
     - `totalToolCalls`: COUNT WHERE event_type = 'tool_call'
     - `totalSyncs`: COUNT WHERE event_type = 'sync'
     - `totalGovernanceDecisions`: COUNT WHERE event_type = 'governance_decision'
     - `serverCrashes`: COUNT WHERE event_type = 'server_event' AND action = 'crash'
     - `topTools`: GROUP BY action, COUNT, ORDER BY count DESC LIMIT 10
     - `topServers`: GROUP BY source, COUNT, ORDER BY count DESC LIMIT 10
     - `dailyCounts`: GROUP BY date(created_at), COUNT for the last N days
2. These are Tauri commands invoked directly from the frontend (no sidecar round-trip needed for reads)

**Files**:
- Update `apps/desktop-companion/src-tauri/src/commands.rs` (~60 lines)

**Validation**:
- [ ] `query_usage` returns filtered events
- [ ] `get_usage_summary` returns correct aggregations
- [ ] Queries perform well with 30 days of data (~10k rows)

---

## Subtask T028: Implement 30-Day Data Pruning

**Purpose**: Automatically delete usage events older than 30 days.

**Steps**:
1. Add a Rust function `prune_usage_data(db)`:
   ```sql
   DELETE FROM usage_events WHERE created_at < datetime('now', '-30 days')
   ```
2. Run on app startup (in `main.rs` setup)
3. Schedule periodic pruning every 24 hours via `tokio::time::interval`
4. Log number of pruned records

**Files**:
- Update `apps/desktop-companion/src-tauri/src/commands.rs` or new file `db.rs` (~25 lines)
- Update `apps/desktop-companion/src-tauri/src/main.rs` (schedule, ~10 lines)

**Validation**:
- [ ] Events older than 30 days are deleted on startup
- [ ] Periodic pruning runs every 24 hours
- [ ] Recent events are preserved

---

## Subtask T029: Implement Onboarding IPC Method

**Purpose**: Execute the first-run onboarding flow from the sidecar.

**Steps**:
1. Register `onboarding.start` IPC method:
   - Params: `{ authToken: string, tenantId: string, workspaceId: string }`
   - Steps:
     1. Store auth credentials in app_config via Rust command
     2. Initialize mcp-registry and start all servers
     3. Trigger skill sync
     4. Write managed entries to `.mcp.json` via `claudeCodeIntegration`
   - Returns: `{ success: boolean, serversStarted: number, skillsSynced: boolean }`
2. Each step can fail independently — return partial success with details
3. Store `onboarding_complete: true` in app_config on success

**Files**:
- Update `apps/desktop-companion/src/sidecar/services.ts` (~50 lines)

**Validation**:
- [ ] `onboarding.start` with valid params configures everything
- [ ] Partial failure returns meaningful error details
- [ ] `onboarding_complete` flag is persisted

---

## Subtask T030: Tests for Usage & Onboarding

**Purpose**: 100% coverage for usage collector, pruning, and onboarding.

**Steps**:
1. Create `apps/desktop-companion/test/sidecar/usage-onboarding.test.ts`:
   - Test usage collector records events correctly
   - Test usage.query with various filter combinations
   - Test usage.summary aggregation logic
   - Test 30-day pruning (create events with old timestamps, verify deletion)
   - Test onboarding.start happy path
   - Test onboarding.start with partial failures
   - Test onboarding_complete flag persistence

**Files**:
- `apps/desktop-companion/test/sidecar/usage-onboarding.test.ts` (new, ~160 lines)

**Validation**:
- [ ] All tests pass with 100% coverage

---

## Definition of Done

- [ ] Usage events are collected from tool calls, syncs, and governance decisions
- [ ] Query and summary methods return correct data
- [ ] 30-day pruning works on startup and periodically
- [ ] Onboarding method configures the full system
- [ ] 100% test coverage

## Activity Log

- 2026-03-14T22:51:52Z – agent-wp06 – shell_pid=66406 – lane=doing – Started implementation via workflow command
- 2026-03-14T23:17:01Z – agent-wp06 – shell_pid=66406 – lane=done – Complete
