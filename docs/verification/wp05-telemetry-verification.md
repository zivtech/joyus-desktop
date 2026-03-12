# WP05 Telemetry Verification Plan

## Purpose

Verify the telemetry pipeline works end-to-end across Cowork and CLI channels, events are correctly recorded, opt-out functions properly, and reporting reflects actual usage.

## Test Scenarios

### Scenario 1: Cowork Skill Invocation

**Objective**: Verify that invoking a skill in Cowork results in an event appearing in the aggregation endpoint.

**Steps**:
1. Log into Claude Cowork as a test user (org: zivtech).
2. Invoke a distributed skill (e.g., `/proposal-critic` with sample content).
3. Skill completes successfully.
4. Wait 60 seconds for async processing.
5. Query the aggregation endpoint: `GET /api/telemetry/events?org=zivtech&user=<test-user>&limit=1`
6. Verify:
   - Event appears in results.
   - event_type = "skill_invocation"
   - name = "proposal-critic"
   - channel = "cowork"
   - outcome = "success"
   - timestamp is recent (within 60 seconds)

**Success Criteria**: Event visible in aggregation endpoint with correct data.

---

### Scenario 2: CLI Skill Invocation

**Objective**: Verify that invoking a skill in Claude Code CLI results in an event appearing in the aggregation endpoint.

**Steps**:
1. Sign into Claude Code CLI as a test developer (org: zivtech).
2. Invoke a skill: `/skill-name` followed by some action.
3. Skill completes.
4. Wait 60 seconds for batch flush.
5. Query the aggregation endpoint with the CLI test user ID.
6. Verify:
   - Event appears.
   - event_type = "skill_invocation"
   - channel = "cli"
   - outcome = "success"
   - duration_ms is recorded (non-zero)

**Success Criteria**: Event visible with channel = "cli".

---

### Scenario 3: MCP Tool Call

**Objective**: Verify that invoking an MCP tool from Cowork results in an event with event_type = "mcp_tool_call".

**Steps**:
1. Log into Cowork as test user.
2. Ask Claude to use an MCP tool (e.g., "Search Jira for issues with label 'urgent'").
3. Claude invokes the Atlassian MCP tool.
4. Tool completes and returns results.
5. Wait 60 seconds.
6. Query aggregation endpoint for events with event_type = "mcp_tool_call".
7. Verify:
   - event_type = "mcp_tool_call"
   - name = "Jira search" or similar tool name
   - channel = "cowork"
   - outcome = "success" (assuming tool succeeded)

**Success Criteria**: Event recorded with event_type = "mcp_tool_call".

---

### Scenario 4: Opt-Out Verification

**Objective**: Verify that users who opt out generate zero telemetry events.

**Steps**:
1. Create two test users in zivtech: test-user-1 (opted in) and test-user-2 (opted out).
2. In test-user-2's Cowork profile (or via CLI config), enable telemetry opt-out:
   - Cowork: Set user preference `telemetry_disabled = true` (if available).
   - CLI: Set environment variable `SKILL_TELEMETRY_DISABLED=true`.
3. Invoke the same skill with both users.
4. Wait 60 seconds.
5. Query aggregation endpoint:
   - For test-user-1: should return 1 event.
   - For test-user-2: should return 0 events.

**Success Criteria**: Opted-out user generates zero events.

---

### Scenario 5: Opt-In Resume

**Objective**: Verify that disabling opt-out resumes event collection.

**Steps**:
1. Start with test-user-2 from Scenario 4 (opted out).
2. Disable opt-out: remove `telemetry_disabled` or unset `SKILL_TELEMETRY_DISABLED`.
3. Invoke a skill.
4. Wait 60 seconds.
5. Query aggregation endpoint for test-user-2.
6. Verify: event appears from this new invocation.

**Success Criteria**: Events resume immediately after opt-out is disabled.

---

### Scenario 6: Usage Report Accuracy

**Objective**: Verify that the admin usage report correctly aggregates the test events.

**Steps**:
1. Run Scenarios 1–5 (generate multiple events across users, skills, channels).
2. Generate usage report: `node scripts/generate-usage-report.js --org zivtech --days 1`
3. Verify report includes:
   - Active users: count of unique users who invoked skills (test-user-1, etc.).
   - Total invocations: sum of all events (should match or exceed number of manual invocations).
   - Top skills: "proposal-critic" should be listed with correct count.
   - Top MCPs: "Jira search" or tool name should be listed.
   - Success rate: should reflect outcomes ("success", "failure", "timeout").
   - Never used skills: skills in the bundle but with zero events.
   - Per-channel breakdown: counts for "cowork" and "cli" channels.

**Success Criteria**: Report shows correct metrics matching manual invocations.

---

### Scenario 7: Event Schema Validation

**Objective**: Verify that all events conform to the schema with correct field types.

**Steps**:
1. Query a sample of 10 events: `GET /api/telemetry/events?org=zivtech&limit=10`
2. For each event, validate:
   - event_id: UUID v4 format
   - timestamp: ISO 8601 date-time
   - user_id: non-empty string
   - org_id: one of {"zivtech", "milk-jawn"}
   - channel: one of {"cowork", "cli", "desktop"}
   - event_type: one of {"skill_invocation", "mcp_tool_call"}
   - name: non-empty string
   - version: semantic version (if present)
   - outcome: one of {"success", "failure", "timeout"}
   - duration_ms: non-negative integer (if present)
   - metadata: valid JSON object
   - schema_version: "v1"
   - created_at: ISO 8601 date-time (server-side timestamp)

**Success Criteria**: All events have required fields with correct types.

---

### Scenario 8: Batch Event Delivery

**Objective**: Verify that multiple events batched together arrive at the aggregation endpoint.

**Steps**:
1. In CLI environment, collect 5 skill invocations without forcing a flush.
2. Trigger a flush (e.g., end session or call flush command).
3. Verify that all 5 events are POSTed in a single batch request.
4. Query aggregation endpoint for the batch.
5. Verify all 5 events are present with sequential timestamps.

**Success Criteria**: All batched events arrive and are correctly stored.

---

### Scenario 9: Offline Resilience

**Objective**: Verify that events are buffered when the endpoint is unreachable and delivered when it comes back.

**Steps**:
1. Stop or simulate unavailability of the telemetry aggregation endpoint.
2. Invoke 3 skills in CLI (or Cowork, if wrapper includes local buffering).
3. Verify that events are buffered locally (check local log file or memory buffer).
4. Re-enable the aggregation endpoint.
5. Trigger a flush or wait for next batch window.
6. Query aggregation endpoint.
7. Verify all 3 buffered events are now present.

**Success Criteria**: Events are not lost during endpoint downtime; they are delivered when endpoint is reachable.

---

## Acceptance Criteria

All scenarios must pass:

- [ ] Scenario 1: Cowork skill events appear in aggregation
- [ ] Scenario 2: CLI skill events appear in aggregation
- [ ] Scenario 3: MCP tool events recorded with correct event_type
- [ ] Scenario 4: Opted-out users generate zero events
- [ ] Scenario 5: Opt-in resumes event collection
- [ ] Scenario 6: Usage report reflects actual invocation counts
- [ ] Scenario 7: All events have correct schema and types
- [ ] Scenario 8: Batched events delivered together
- [ ] Scenario 9: Events buffered and retried when endpoint unreachable

**Additional NFRs**:

- [ ] Collection latency: <100ms added to skill execution (verified with profiling)
- [ ] Endpoint availability: 99.5% uptime (or document expected downtime)
- [ ] Schema version: All events include `schema_version: "v1"`
- [ ] No PII: Zero conversation content, tool arguments, or user input in events

---

## Test Execution

### Unit Tests

Test event schema validation, opt-out logic, and client library:

```bash
pnpm vitest run packages/telemetry/test/
```

**Coverage**: Must achieve 100% on collector code paths.

### Integration Tests

Test end-to-end flows with a local or staging aggregation endpoint:

```bash
pnpm test:integration --env staging
```

### Manual Verification (Phase 2)

Test against live joyus-ai endpoint with real Cowork and CLI sessions:

1. Designate test users in zivtech and milk-jawn Cowork workspaces.
2. Invoke skills and MCPs per Scenarios 1–9.
3. Query live aggregation endpoint.
4. Document results in a verification report.

---

## Test Data & Fixtures

### Sample Event (Cowork Skill)

```json
{
  "event_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "timestamp": "2026-03-11T15:30:45.123Z",
  "user_id": "cowork-user-abc123",
  "org_id": "zivtech",
  "channel": "cowork",
  "event_type": "skill_invocation",
  "name": "proposal-critic",
  "version": "1.2.0",
  "outcome": "success",
  "duration_ms": 2450,
  "metadata": {
    "invocation_method": "slash_command"
  }
}
```

### Sample Event (CLI Skill)

```json
{
  "event_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "timestamp": "2026-03-11T16:00:12.456Z",
  "user_id": "cli-user-dev@zivtech.com",
  "org_id": "zivtech",
  "channel": "cli",
  "event_type": "skill_invocation",
  "name": "project-recap",
  "version": "2.1.0",
  "outcome": "success",
  "duration_ms": 3120,
  "metadata": {}
}
```

### Sample Event (MCP Tool)

```json
{
  "event_id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "timestamp": "2026-03-11T16:15:30.789Z",
  "user_id": "cowork-user-abc123",
  "org_id": "zivtech",
  "channel": "cowork",
  "event_type": "mcp_tool_call",
  "name": "Jira search",
  "version": "1.0.0",
  "outcome": "success",
  "duration_ms": 1250,
  "metadata": {
    "mcp_server": "atlassian",
    "tool_method": "search_issues"
  }
}
```

---

## Issue Tracking

Document failures or observations in the WP05 task system:

| Scenario | Status | Notes |
|----------|--------|-------|
| Cowork skill events | ✓ PASS | Event recorded within 60s |
| CLI skill events | ✓ PASS | Event recorded with correct channel |
| MCP tool events | [ ] TBD | Awaiting MCP wrapper implementation |
| Opt-out | [ ] TBD | Requires opt-out flag implementation |
| Report accuracy | [ ] TBD | Depends on report script completion |

---

## References

- Telemetry Event Schema: `packages/telemetry/src/schema.ts`
- Cowork Collection Design: `docs/telemetry/cowork-collection.md`
- Aggregation Architecture: `docs/telemetry/aggregation-architecture.md`
- WP05 Work Package: `kitty-specs/003-skill-mcp-distribution/tasks/WP05-telemetry.md`
