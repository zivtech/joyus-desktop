---
work_package_id: WP05
title: Telemetry Foundation
lane: planned
dependencies: []
subtasks:
- T024
- T025
- T026
- T027
- T028
- T029
- T030
phase: Phase 1 - Cowork Distribution
assignee: ''
agent: ''
shell_pid: ''
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-03-10T00:00:00Z'
  lane: planned
  agent: ''
  action: Prompt generated
---

# Work Package Prompt: WP05 - Telemetry Foundation

## Objective

Build a telemetry pipeline that captures skill and MCP usage events from Cowork and CLI channels, aggregates them for admin reporting, and supports per-user opt-out — enabling ROI measurement and adoption gap identification.

## Context

Without telemetry, there's no way to know if distribution is working. Admins need to see: who's using what skills/MCPs, how often, with what outcomes. The pipeline must work across both Cowork (web) and CLI channels, not degrade user sessions (NFR-004), and respect per-user opt-out (FR-008). Phase 2 (WP09) will extend this to desktop companion channel.

**Requirements**: FR-007, FR-008, NFR-004, SC-004

## Subtasks

### T024: Define telemetry event schema

**Purpose**: Standardize what data is collected for each skill/MCP invocation.

**Steps**:
1. Define the event structure:
   ```typescript
   interface TelemetryEvent {
     event_id: string;          // UUID
     timestamp: string;         // ISO 8601
     user_id: string;           // Cowork/CLI user identifier
     org_id: string;            // "zivtech" | "milk-jawn"
     channel: "cowork" | "cli" | "desktop";
     event_type: "skill_invocation" | "mcp_tool_call";
     name: string;              // Skill or tool name
     version: string;           // Skill version (from pin)
     outcome: "success" | "failure" | "timeout";
     duration_ms: number;       // Execution time
     metadata: Record<string, string>;  // Extensible, no PII
   }
   ```
2. Define required vs optional fields:
   - Required: event_id, timestamp, user_id, org_id, channel, event_type, name, outcome
   - Optional: version, duration_ms, metadata
3. **Privacy rule**: NO conversation content, NO tool arguments, NO user input. Only metadata about the invocation.
4. Document the schema in a shared format (TypeScript interface + JSON Schema).
5. Version the schema as `v1` for future evolution.

**Files**: `packages/telemetry/src/schema.ts` or `config/telemetry-schema.json`

**Validation**: Schema is parseable, well-documented. Covers all fields from FR-007. No PII beyond user_id/org_id.

---

### T025: Identify Cowork-side collection mechanism

**Purpose**: Determine how to capture telemetry from Cowork plugin usage.

**Steps**:
1. Research Cowork's admin analytics:
   - Does Cowork provide native plugin usage analytics? Check admin panel.
   - Does Cowork expose webhook/event hooks when plugins are invoked?
   - Does Cowork have an API for usage data export?
2. Evaluate options:
   - **Option A**: Native analytics — use Cowork's built-in data (best if available)
   - **Option B**: Plugin wrapper — skill prompt includes a step to call a logging endpoint before executing
   - **Option C**: Cowork admin API — periodic export of usage data
3. If no native mechanism exists, design the plugin wrapper approach:
   - Each skill plugin includes a preamble: "Before responding, silently log this invocation to [endpoint]"
   - Or: add a Cowork connector that acts as a telemetry sink
4. Prototype the chosen approach and document trade-offs.

**Files**: `docs/telemetry/cowork-collection.md`, prototype code if applicable

**Validation**: Clear mechanism identified. Documented with pros/cons. Prototype demonstrates feasibility.

---

### T026: Identify CLI-side collection mechanism

**Purpose**: Capture telemetry from Claude Code CLI skill usage without adding latency.

**Steps**:
1. Research Claude Code hook events:
   - Is there a `post_skill_invocation` or `post_tool_use` hook?
   - Can hooks capture skill name and outcome?
2. Evaluate options:
   - **Option A**: Post-tool-use hook that fires an HTTP event to telemetry endpoint
   - **Option B**: Skill wrapper script that logs before/after execution
   - **Option C**: Append to a local log file, batch-upload periodically
3. Choose approach prioritizing:
   - Async/non-blocking (NFR-004 — no session degradation)
   - Reliability (events shouldn't be lost on crash)
   - Simplicity (minimal code in the critical path)
4. Implement prototype:
   - Hook or wrapper that captures: skill name, start time, end time, outcome
   - Sends event to aggregation endpoint (async, fire-and-forget)
   - Falls back to local file buffer if endpoint unreachable

**Files**: `packages/telemetry/src/cli-collector.ts`, hook configuration

**Validation**: CLI skill invocation generates a telemetry event. Collection adds <100ms latency. Events buffered when offline.

---

### T027: Stand up aggregation endpoint or reuse joyus-ai infrastructure

**Purpose**: Central receiver where telemetry events are stored and queryable.

**Steps**:
1. Evaluate infrastructure options:
   - **joyus-ai**: Does it have an endpoint that can accept telemetry? Check existing API surface.
   - **Supabase**: Create a `telemetry_events` table + Edge Function for ingestion
   - **Lightweight serverless**: Cloudflare Worker / Vercel Edge Function → append to database
   - **Google Sheets API**: For simplest possible v1 (append rows via API)
2. Choose based on:
   - Existing infrastructure (prefer reuse over new)
   - Query capability (admin needs to filter by org, user, date range)
   - Cost (should be negligible at current scale — <100 users)
3. Implement the chosen endpoint:
   - `POST /api/telemetry/events` — accepts single event or batch
   - Authentication: API key or service token
   - Rate limit: 100 events/minute per client
   - Response: 202 Accepted (async processing)
4. Set up basic retention: keep raw events 90 days, aggregates indefinitely.
5. Test: POST a sample event → query it back.

**Files**: Endpoint code or configuration, `docs/telemetry/aggregation-architecture.md`

**Validation**: Events can be POSTed and retrieved. Endpoint handles batch events. Authentication works.

---

### T028: Build admin usage report (script or dashboard)

**Purpose**: Admin can view aggregated telemetry to measure ROI and identify adoption gaps (SC-004).

**Steps**:
1. Define key metrics:
   - Active users per week (by org)
   - Invocations per skill per week
   - Most/least used skills
   - MCP connector usage by org
   - Success/failure rate per skill
   - Adoption: users who have never invoked a skill
2. Build a report generator (Python script or Node script):
   - Query the aggregation endpoint/database
   - Compute metrics
   - Output as formatted markdown table or HTML report
3. Support filtering: by org, time range, user, skill/tool name.
4. Example output:
   ```
   Usage Report: 2026-03-01 to 2026-03-10 | Zivtech
   ─────────────────────────────────────────────────
   Active Users: 8/12 (67%)
   Total Invocations: 142
   Top Skills: proposal-critic (38), copy-critic (24), project-recap (18)
   Top MCPs: Atlassian (45), Slack (32), Google (21)
   Never Used: drupal-planner, react-planner (developer-only in PM bundle?)
   ```
5. Enable on-demand generation: `node generate-report.js --org zivtech --days 7`

**Files**: `packages/telemetry/src/reports/usage-report.ts` or `scripts/generate-usage-report.js`

**Validation**: Report shows per-user, per-skill metrics. Filtering works. Output is readable and actionable.

---

### T029: Implement per-user telemetry opt-out mechanism (FR-008)

**Purpose**: Users must be able to opt out of telemetry collection.

**Steps**:
1. Define opt-out mechanisms per channel:
   - **Cowork**: User setting in profile (if Cowork supports it), or explicit request to admin
   - **CLI**: Environment variable `SKILL_TELEMETRY_DISABLED=true` or config in `~/.claude/telemetry.json`
   - **Desktop** (Phase 2): Setting in companion preferences
2. Implementation:
   - Collector checks opt-out flag BEFORE sending any event
   - If opted out: event is discarded immediately (not even constructed)
   - Opt-out status stored locally per user — not sent to server
3. Admin visibility:
   - Admin can see which users have opted out (for compliance tracking)
   - Admin CANNOT override opt-out (respect user choice)
4. Document opt-out process for users in the OAuth/setup guide.

**Files**: Opt-out config in collectors, user documentation update

**Validation**: User opts out → zero events recorded for that user. Opt back in → events resume. Admin sees opt-out status but cannot override.

---

### T030: Verify events appear for both Cowork and CLI usage

**Purpose**: End-to-end verification that the telemetry pipeline works across channels.

**Steps**:
1. Invoke a skill in Cowork → wait 60s → verify event in aggregation endpoint.
2. Invoke a skill in CLI → wait 60s → verify event in aggregation endpoint.
3. Invoke an MCP tool in Cowork → verify event appears.
4. Test opt-out: enable opt-out for a user → invoke skill → verify NO event recorded.
5. Generate usage report → verify it includes the test events with correct data.
6. Verify event schema: all required fields present, correct types.

**Files**: `docs/verification/wp05-telemetry-verification.md`

**Validation**: Events from both channels appear in aggregation. Report reflects actual usage. Opt-out works. Schema validated.

## Implementation Notes

- **Start simple**: A Supabase table + Edge Function is sufficient for v1. Don't over-engineer.
- **Dashboard v1**: A CLI script that generates a markdown table is fine. Save the fancy dashboard for later.
- **Privacy first**: NEVER include conversation content or tool arguments. Only invocation metadata.
- **Batching**: Consider batching events (send every 60s or on session end) rather than per-invocation to reduce overhead.
- **joyus-ai reuse**: Check if the existing server infrastructure can accept telemetry — adding a table and endpoint to an existing service is simpler than deploying new infrastructure.

## Done Criteria

- [ ] Telemetry event schema defined and documented (T024)
- [ ] Cowork collection mechanism identified and prototyped (T025)
- [ ] CLI collection mechanism implemented (T026)
- [ ] Aggregation endpoint operational (T027)
- [ ] Admin usage report functional (T028)
- [ ] Per-user opt-out working (T029)
- [ ] Events verified from both Cowork and CLI channels (T030)

## Risks & Edge Cases

- **Cowork limitations**: Cowork may not expose plugin invocation hooks — telemetry may be limited to native analytics
- **Endpoint downtime**: Events should be buffered locally and retried, not silently lost
- **Volume**: High-volume users could generate many events — batch and rate-limit client-side
- **Privacy compliance**: Ensure telemetry disclosure in user onboarding. Check if GDPR/privacy requirements apply.
- **Clock skew**: Use server-side timestamps for aggregation, client-side only for latency calculation
- **Schema evolution**: Version the schema now so future changes don't break the pipeline

## Implementation Command

```bash
spec-kitty implement WP05 --base WP01
```

## Activity Log

- 2026-03-10: Prompt generated in planned lane.
