# Cowork-Side Telemetry Collection

## Overview

Cowork-side telemetry collection captures usage events from skill and MCP invocations within the Claude Cowork web interface. The goal is to measure adoption, identify popular features, and support ROI reporting for distributed skills and connectors.

## Options Evaluated

### Option A: Native Cowork Analytics

**Availability**: As of March 2026, Cowork does not expose native plugin invocation hooks or analytics APIs to team admins. Cowork's analytics panel shows general session metrics but not per-skill or per-tool usage.

**Trade-offs**:
- Pro: No additional code required if native data were available.
- Con: Not currently available; would require Anthropic to add new admin API.

**Status**: Not viable for Phase 1.

---

### Option B: Plugin Wrapper Approach

**Mechanism**: Each distributed skill plugin includes a telemetry wrapper. Before the skill executes, the wrapper silently logs invocation metadata to the telemetry ingestion endpoint (`POST /api/telemetry/events` on joyus-ai). The wrapper is non-blocking (fire-and-forget) and transparent to the user.

**Implementation**:
- Skill prompt template includes preamble: "Before responding, silently log this invocation to [endpoint]."
- Wrapper captures:
  - Skill name
  - Invocation start time
  - Invocation end time
  - Outcome (success/failure/timeout)
  - User ID and org ID (from Cowork context)
- Endpoint call is async; if the endpoint is unreachable, execution continues unaffected.

**Trade-offs**:
- Pro: Works regardless of Cowork's native analytics capabilities.
- Pro: Consistent event schema across Cowork and CLI channels.
- Pro: Simple, requires only a preamble step in each skill prompt.
- Con: Requires wrapper code in each distributed skill.
- Con: Depends on endpoint availability (mitigated by fire-and-forget, no impact on skill execution).
- Con: Cowork web environment may have limited HTTP request capabilities (CORS, mixed-content restrictions).

**Status**: Recommended for Phase 1.

---

### Option C: Cowork Admin API Periodic Export

**Mechanism**: Admins or a service periodically invoke a Cowork API to export usage data for all plugins/connectors in the org, then push that data to joyus-ai.

**Trade-offs**:
- Pro: Decoupled from skill execution; no per-invocation overhead.
- Pro: Reduces client-side complexity.
- Con: Cowork does not currently expose a usage export API.
- Con: Introduces polling/batch-processing latency; events not available in real-time.
- Con: Requires credential management for the export service.

**Status**: Not viable for Phase 1; may revisit if Anthropic adds admin APIs.

---

## Recommended Approach: Plugin Wrapper (Option B)

Each skill distributed to Cowork includes a telemetry wrapper that logs invocation metadata asynchronously.

### Design

#### Telemetry Wrapper Placement

The wrapper runs **before** the skill's main logic:

```
Skill invocation (user triggers /skill-name in Cowork)
  ↓
1. Wrapper captures start metadata (timestamp, user ID, org ID, skill name)
2. Wrapper sends async HTTP POST to telemetry endpoint
3. Skill logic executes
4. Wrapper captures end metadata (outcome, duration)
5. (Optional) Wrapper sends final event with outcome if not yet sent
```

#### Event Payload

Each event sent to `/api/telemetry/events`:

```json
{
  "event_id": "uuid-v4",
  "timestamp": "2026-03-11T15:30:45.123Z",
  "user_id": "cowork-user-id",
  "org_id": "zivtech",
  "channel": "cowork",
  "event_type": "skill_invocation",
  "name": "proposal-critic",
  "version": "1.2.0",
  "outcome": "success",
  "duration_ms": 2450,
  "metadata": {
    "invocation_method": "slash_command",
    "model": "claude-opus"
  }
}
```

#### Privacy & Data Minimization

- **NO conversation content**: Wrapper does not capture the user's prompt or skill response.
- **NO tool arguments**: If the skill uses MCP tools, wrapper does not capture tool inputs.
- **NO user input**: Wrapper does not log the text the user entered.
- **Captured only**: Skill name, invocation time, outcome, duration, channel, org, user ID.

#### Opt-Out Mechanism

Wrapper checks a per-user opt-out flag before constructing any event:

1. Wrapper reads user's opt-out setting from Cowork preferences (if available) or a centralized opt-out list.
2. If `telemetry_disabled = true` for the user: wrapper skips event construction and sending entirely.
3. If opted out, zero events are generated for that user.
4. Opting back in resumes collection immediately on next invocation.

#### Fallback & Resilience

- Wrapper uses a short timeout (e.g., 5 seconds) for the HTTP POST.
- If the endpoint is unreachable or times out: wrapper logs locally (optional) and continues skill execution.
- Skill execution is never blocked or delayed by telemetry issues.

### Implementation Notes

- **Skill packaging**: When packaging skills for Cowork distribution (WP01), include the wrapper as part of the plugin bundle.
- **Configuration**: Wrapper is configured with the telemetry endpoint URL and API key at distribution time.
- **Testing**: Verify that wrapper does not introduce visible latency or errors in Cowork sessions.

## Integration Points

- **Cowork setup (WP02)**: First-party MCP connectors may also include telemetry wrappers or emit events through a Cowork-specific hook if available.
- **Aggregation endpoint (WP05 T027)**: Receives and stores events from Cowork wrappers.
- **Opt-out mechanism (WP05 T029)**: Manages per-user telemetry disable flags.
- **Verification (WP05 T030)**: Tests end-to-end flow from Cowork skill invocation to event appearance in aggregation endpoint.

## Open Questions

1. **Cowork HTTP limits**: Does Cowork enforce Content Security Policy or CORS restrictions on outbound HTTP from plugins? Prototype required.
2. **User preference storage**: Should opt-out status be stored in Cowork preferences (if available) or in a separate joyus-ai user settings table?
3. **Event latency**: What is acceptable latency between skill invocation and event availability in the aggregation endpoint? (E.g., 60 seconds batch window vs. immediate.)

## References

- Telemetry Event Schema: `packages/telemetry/src/schema.ts`
- Aggregation Endpoint: `docs/telemetry/aggregation-architecture.md`
- Verification Plan: `_private/docs/verification/wp05-telemetry-verification.md`
