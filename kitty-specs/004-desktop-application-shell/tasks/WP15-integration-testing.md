---
work_package_id: WP15
title: Integration Testing & Polish
lane: done
dependencies: []
subtasks: [T063, T064, T065, T066, T067]
agent: agent-wp15
shell_pid: '93253'
review_status: approved
reviewed_by: Alex Urevick-Ackelsberg
history:
- date: '2026-03-14'
  event: created
  note: Generated from spec-kitty.tasks
---

# WP15 — Integration Testing & Polish

**Objective**: Verify the complete application works end-to-end on both platforms through integration tests, real-time update validation, cross-platform smoke testing, and performance benchmarking.

**Implementation command**: `spec-kitty implement WP15 --base WP13`

## Context

All individual components have been built and unit tested in previous WPs. This WP focuses on integration — verifying that the pieces work together as a complete application. It produces the evidence needed to ship with confidence.

---

## Subtask T063: Sidecar Integration Test

**Purpose**: Verify the full sidecar lifecycle: spawn → IPC round-trip → shutdown.

**Steps**:
1. Create `apps/desktop-companion/test/integration/sidecar-lifecycle.test.ts`:
   - Spawn the bundled sidecar as a child process (same way Rust does)
   - Send `health.check` request, verify response
   - Send `servers.list` request, verify response schema
   - Send `sync.status` request, verify response
   - Send SIGTERM, verify clean exit within 5 seconds
2. Test error cases:
   - Send malformed JSON, verify -32700 error
   - Send unknown method, verify -32601 error
   - Send concurrent requests, verify correct response correlation
3. Run against the esbuild bundle (`binaries/sidecar-main.mjs`), not source files

**Files**:
- `apps/desktop-companion/test/integration/sidecar-lifecycle.test.ts` (new, ~100 lines)

**Validation**:
- [ ] Sidecar starts, responds, and shuts down cleanly
- [ ] Error cases return correct JSON-RPC errors
- [ ] Concurrent requests are handled correctly

---

## Subtask T064: Onboarding Integration Test

**Purpose**: Verify the complete onboarding flow from first launch to dashboard.

**Steps**:
1. Create `apps/desktop-companion/test/integration/onboarding-flow.test.ts`:
   - Mock auth service (return valid token)
   - Call `onboarding.start` with mock credentials
   - Verify MCP servers are registered (check sidecar state)
   - Verify skills are synced (check file system)
   - Verify `.mcp.json` is updated with managed entries
   - Verify `onboarding_complete` flag is set
2. Test partial failure:
   - Mock one server failing to start
   - Verify other servers still start
   - Verify partial success is reported correctly

**Files**:
- `apps/desktop-companion/test/integration/onboarding-flow.test.ts` (new, ~80 lines)

**Validation**:
- [ ] Happy path completes all onboarding steps
- [ ] Partial failure preserves successful steps
- [ ] Config flags are set correctly

---

## Subtask T065: Dashboard Real-Time Update Verification

**Purpose**: Verify that state changes propagate from sidecar to dashboard within 5 seconds (SC-006).

**Steps**:
1. Create `apps/desktop-companion/test/integration/realtime-updates.test.ts`:
   - Start sidecar
   - Simulate server crash (kill a mock MCP process)
   - Verify `state.serverChanged` notification is emitted within 1 second
   - Verify notification payload contains correct server name and "error" status
2. Test sync notification:
   - Trigger sync
   - Verify `state.syncCompleted` notification with version and duration
3. Test governance notification:
   - Simulate a governance decision
   - Verify `state.governanceDecision` notification
4. Measure end-to-end latency for each notification type

**Files**:
- `apps/desktop-companion/test/integration/realtime-updates.test.ts` (new, ~90 lines)

**Validation**:
- [ ] Server state changes propagate within 1 second
- [ ] Sync completion is notified
- [ ] Governance decisions are notified
- [ ] All notifications match contract schema

---

## Subtask T066: Cross-Platform Smoke Test Checklist

**Purpose**: Manual verification checklist for both macOS and Windows.

**Steps**:
1. Create `docs/verification/desktop-app-smoke-test.md`:
   - **Install**: Download installer, run, verify app appears
   - **First Launch**: Onboarding wizard appears, complete all steps
   - **System Tray**: Icon appears, context menu works, all items functional
   - **Dashboard**: All 6 pages load, data is displayed
   - **Server Management**: Start/stop/restart a server from dashboard
   - **Sync**: Trigger manual sync, verify skills update
   - **Auto-Start**: Reboot, verify app starts automatically
   - **Update** (if applicable): Verify update notification appears
   - **Quit**: Quit from tray, verify all processes terminate
   - **Re-Launch**: Open app again, verify dashboard loads (not onboarding)
2. Columns: Test, macOS Result, Windows Result, Notes
3. Each test has pass/fail criteria

**Files**:
- `docs/verification/desktop-app-smoke-test.md` (new, ~60 lines)

**Validation**:
- [ ] Checklist covers all user stories from the spec
- [ ] Both platforms have columns
- [ ] Smoke test includes `.mcp.json` tampering test: delete managed entries, relaunch app, verify re-added (SC-010)

---

## Subtask T067: Performance Validation

**Purpose**: Verify the app meets success criteria for startup time, memory, and sync speed.

**Steps**:
1. Create `apps/desktop-companion/test/integration/performance.test.ts`:
   - **SC-003**: Measure time from sidecar spawn to first successful `servers.list` response. Target: <10 seconds.
   - **SC-007**: Measure sidecar process RSS memory after startup with no active requests. Target: <50 MB.
   - **SC-008**: Measure sync duration with warm cache. Target: <15 seconds.
   - **SC-004**: Simulate server crash, measure time until watchdog restart completes. Target: <30 seconds.
2. Run benchmarks 3 times each, report median
3. Log results to stdout for CI capture

**Files**:
- `apps/desktop-companion/test/integration/performance.test.ts` (new, ~70 lines)

**Validation**:
- [ ] Startup to MCP ready: <10 seconds
- [ ] Idle memory: <50 MB
- [ ] Warm sync: <15 seconds
- [ ] Watchdog restart: <30 seconds

---

## Definition of Done

- [ ] Sidecar lifecycle integration test passes
- [ ] Onboarding integration test passes
- [ ] Real-time updates propagate within 5 seconds
- [ ] Smoke test checklist completed for both platforms
- [ ] Performance benchmarks meet all success criteria
- [ ] All evidence documented for ship decision

## Activity Log

- 2026-03-15T00:20:19Z – agent-wp15 – shell_pid=93253 – lane=doing – Started implementation via workflow command
- 2026-03-15T00:23:41Z – agent-wp15 – shell_pid=93253 – lane=done – Integration tests, smoke test, perf benchmarks
