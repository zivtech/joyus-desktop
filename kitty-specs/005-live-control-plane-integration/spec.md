# Feature Specification: Live Control Plane Integration & Pilot Readiness

**Feature Branch**: `005-live-control-plane-integration`
**Created**: 2026-03-18
**Status**: Draft
**Input**: joyus-desktop 001–004 are complete. joyus-ai is deployed (spec 010 in joyus-ai-ops). This feature wires the desktop to the live control plane and validates the full pilot path.

## Scope

### In Scope

- Replace all stub/mock control plane calls in `packages/policy-client` and `apps/desktop-companion` with real HTTP calls to the deployed joyus-ai API.
- Connection layer hardening: define requirements for mTLS, token refresh, retry behavior, and timeout handling. Implementation of PKI/certificates is owned by joyus-ai-ops and is out of scope here.
- Internal pilot path validation: confirm that a generic internal user running the local companion produces real policy decisions flowing to the live control plane.
- External tenant pilot path validation: confirm that a generic external tenant is forced onto the remote workspace path and cannot execute privileged actions locally.
- Operational readiness gate: alerting on policy failures, artifact provenance queryable end-to-end, incident runbook walkthrough complete.

### Out of Scope

- PKI infrastructure, certificate issuance, and mTLS certificate management (owned by joyus-ai-ops).
- Server-side policy engine changes (owned by joyus-ai).
- Control plane API contract definition (confirmed at implementation time against the deployed joyus-ai API).
- Full desktop screen recording.
- Multi-provider agent adapters beyond the current MCP flow.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Real Policy Decision on Privileged Action (Priority: P0)

A desktop companion making a privileged action must receive a real signed decision token from the live joyus-ai control plane, not a stub response.

**Why this priority**: This is the primary trust guarantee the entire desktop security model depends on.

**Independent Test**: Integration tests confirm that a policy decision request reaches the live API and the returned token is validated before the action proceeds.

**Acceptance Scenarios**:

1. **Given** the companion is connected to the live control plane, **When** a privileged action is requested, **Then** the companion calls `/v1/policy/decide` and receives a signed decision token.
2. **Given** a valid signed token is returned, **When** the companion evaluates the token, **Then** the action is allowed, denied, or escalated according to the token's outcome.
3. **Given** the control plane returns an error, **When** the companion evaluates the response, **Then** existing fail-closed behavior from spec 001 applies.

---

### User Story 2 — Replay Attack Rejected and Logged (Priority: P0)

A previously-used decision token must be rejected if presented again.

**Why this priority**: Replay attacks are the primary token abuse vector identified in the threat model.

**Independent Test**: Integration tests confirm that replaying a consumed token returns a rejection and the attempt is logged to `/v1/events`.

**Acceptance Scenarios**:

1. **Given** a decision token has already been consumed, **When** it is presented again, **Then** the control plane rejects it with an explicit replay error.
2. **Given** a replay rejection occurs, **When** the companion processes the response, **Then** a replay event is emitted to `/v1/events` and the action is blocked.

---

### User Story 3 — Internal Pilot: Local Companion with Live Policy (Priority: P1)

An internal pilot user running the local companion must have their policy decisions routed to the live control plane, with the full event trail visible.

**Why this priority**: Validates the internal path end-to-end before external rollout.

**Independent Test**: Pilot acceptance test — internal user runs a privileged action; control plane logs show the corresponding policy decision and event records.

**Acceptance Scenarios**:

1. **Given** an internal tenant user runs the local companion, **When** they execute a privileged action, **Then** a policy decision record appears in the live control plane.
2. **Given** an internal tenant user, **When** the local companion emits action metadata, **Then** the event record is queryable via `/v1/events` with correct session, tenant, and action fields.

---

### User Story 4 — External Tenant Forced onto Remote Workspace (Priority: P1)

An external tenant must not be able to execute privileged actions locally; the companion must enforce remote workspace routing through the live control plane.

**Why this priority**: The external path is the highest-risk enforcement gap if unstubbed.

**Independent Test**: Pilot acceptance test — external tenant attempts a local privileged action; companion routes to remote workspace via live `/v1/workspaces`.

**Acceptance Scenarios**:

1. **Given** an external tenant identity, **When** the companion evaluates a privileged action, **Then** it calls `/v1/workspaces` to obtain a remote workspace before execution.
2. **Given** `/v1/workspaces` returns an error, **When** the companion processes the response, **Then** the action is blocked (fail closed), not rerouted locally.
3. **Given** an external tenant, **When** the companion checks runtime routing, **Then** local execution is never selected regardless of local companion availability.

---

### User Story 5 — Artifact Provenance Queryable (Priority: P1)

Every output artifact produced during a piloted session must be registered and retrievable with full provenance.

**Why this priority**: Provenance queryability is a hard exit criterion for pilot readiness.

**Independent Test**: Pilot acceptance test — artifact registered via `/v1/artifacts`; provenance query returns session, policy decision reference, and routed skills.

**Acceptance Scenarios**:

1. **Given** the companion completes a session that produces an output artifact, **When** the artifact is registered via `/v1/artifacts`, **Then** the provenance record includes session ID, policy decision token reference, and skill routing metadata.
2. **Given** an artifact provenance record exists, **When** queried, **Then** the record is retrievable and links back to the originating session and policy decision.

---

### User Story 6 — Companion Survives Control Plane Outage Without Bypass (Priority: P0)

If the live control plane becomes unreachable, the companion must not allow privileged actions to proceed as if enforcement were active.

**Why this priority**: Outage-driven bypass is the most dangerous failure mode and was specified as a hard exit criterion.

**Independent Test**: Failure injection test — control plane unreachable; companion enforces fail-closed per spec 001 rules with no regression from current behavior.

**Acceptance Scenarios**:

1. **Given** the control plane is unreachable, **When** an external medium/high-risk privileged action is requested, **Then** it is blocked (same behavior as spec 001 FR-006).
2. **Given** the control plane is unreachable, **When** an internal high-risk action is requested, **Then** it is blocked (same behavior as spec 001 FR-007).
3. **Given** the control plane recovers, **When** the companion reconnects, **Then** policy enforcement resumes automatically without a manual restart.

---

### Edge Cases

- Decision token returned with mismatched tenant, session, or action hash (must be rejected).
- Token refresh race condition: two concurrent requests attempt to refresh the same expiring token simultaneously.
- `/v1/workspaces` call succeeds but workspace provisioning is delayed; companion must not time out silently.
- Event emission to `/v1/events` fails; companion must not block the primary action flow on event delivery failure, but must log locally and retry.
- Control plane returns an unexpected HTTP status code outside the defined contract (must be treated as a policy failure, not an allow).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `packages/policy-client` MUST replace stub control plane calls with real HTTP calls to the deployed joyus-ai API for all four endpoints: `/v1/policy/decide`, `/v1/events`, `/v1/workspaces`, and `/v1/artifacts`.
- **FR-002**: The connection layer MUST implement configurable retry with exponential backoff for transient control plane failures.
- **FR-003**: The connection layer MUST enforce a request timeout on all control plane calls; timeouts MUST be treated as policy failures and trigger fail-closed behavior per spec 001.
- **FR-004**: The connection layer MUST support mutual TLS (mTLS) as the transport security mechanism; certificate material is provided by joyus-ai-ops at deployment time.
- **FR-005**: The connection layer MUST implement token refresh before token expiry, and MUST serialize concurrent refresh attempts to prevent race conditions.
- **FR-006**: Every replay of a consumed decision token MUST be rejected by the control plane; the companion MUST emit a replay event to `/v1/events` on rejection.
- **FR-007**: External tenant runtime routing MUST call `/v1/workspaces` to obtain a remote workspace; local execution MUST NOT be selected for external tenants under any conditions.
- **FR-008**: Output artifacts from piloted sessions MUST be registered via `/v1/artifacts` with provenance fields: session ID, policy decision token reference, and skill routing metadata.
- **FR-009**: Event emission to `/v1/events` MUST be non-blocking; failures MUST be logged locally and retried asynchronously without affecting the primary action flow.
- **FR-010**: The companion MUST restore full policy enforcement automatically when the control plane becomes reachable again after an outage, without requiring a manual restart.
- **FR-011**: Alerting MUST be defined for policy failure rate thresholds; alert definitions are delivered as part of the operational readiness gate.
- **FR-012**: An incident runbook walkthrough MUST be completed and documented as part of pilot readiness sign-off.
- **FR-013**: CI MUST enforce 100% line/function/branch/statement coverage for all modified and new modules.

### Key Entities

- **Control Plane Client**: HTTP client component responsible for all communication with the live joyus-ai API; owns retry, timeout, mTLS, and token refresh logic.
- **Decision Token**: Short-lived signed token issued by `/v1/policy/decide`; contains outcome, tenant/session/action binding, and expiry.
- **Remote Workspace**: Provisioned execution environment for external tenants, obtained via `/v1/workspaces`.
- **Artifact Provenance Record**: Registration entry in `/v1/artifacts` linking an output artifact to its originating session, policy decision, and skill routing path.
- **Policy Event**: Structured record emitted to `/v1/events` capturing policy decisions, replay attempts, and routing decisions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every privileged desktop action in a connected session results in a real signed decision token issued by the live joyus-ai control plane.
- **SC-002**: Replay of any consumed decision token is rejected and produces a logged event — verified across 100% of replay test cases.
- **SC-003**: Zero local privileged executions occur for external tenant identities in any test or pilot scenario.
- **SC-004**: Artifact provenance is queryable for 100% of artifacts produced during pilot sessions.
- **SC-005**: Control plane outage tests confirm no bypass of fail-closed enforcement — behavior identical to spec 001 baselines.
- **SC-006**: Control plane recovery test confirms automatic reconnection and enforcement resumption without manual intervention.
- **SC-007**: Operational readiness gate is complete: alerting defined, provenance query verified, incident runbook walkthrough signed off.
- **SC-008**: CI coverage gate passes at 100% for all modified modules.

### Assumptions

- The joyus-ai control plane API (`/v1/policy/decide`, `/v1/events`, `/v1/workspaces`, `/v1/artifacts`) is live and its contracts are confirmed at implementation time against the deployed service.
- mTLS certificate material and PKI infrastructure are provisioned by joyus-ai-ops before integration testing begins.
- Spec 001 fail-closed behavior is correct and regression-tested; this feature inherits and does not replace it.
- The replay rejection mechanism is implemented server-side in joyus-ai; the companion's role is to handle the rejection response and emit the event.

## Amendments

### Claude Channels: Control Plane Channel Server (2026-03-31)

*Source: [joyus-ai-internal Claude Channels Impact Analysis §4.5](https://github.com/zivtech/joyus-ai-internal/blob/main/planning/claude-channels-impact-analysis.md) — Issue: [#36](https://github.com/zivtech/joyus-ai-internal/issues/36)*

A new MCP server in the joyus-desktop companion that bridges the Gateway Event Bus to the admin's active Claude Code session via Claude Channels.

#### Architecture

```
Gateway Event Bus (joyus-ai, Spec 014)
        |
        | WebSocket (persistent, authenticated)
        v
Channel Server (joyus-desktop companion, local MCP server)
        |
        | notifications/claude/channel (MCP notification)
        v
Claude Code session (admin's active session)
        |
        | MCP tool calls (review_decide, alert_acknowledge, etc.)
        v
Channel Server -> POST /api/v1/gateway/decisions (HTTP)
```

The Channel Server is an MCP server that:
1. Declares `capabilities.experimental['claude/channel']`
2. Maintains a persistent WebSocket to the gateway event bus
3. Subscribes to events for the current tenant (authenticated via the companion's existing mTLS certificate)
4. Re-emits gateway events as `notifications/claude/channel` MCP notifications
5. Exposes MCP tools for admin decisions:
   - `review_decide(executionId, decision, metadata)` — approve/reject pipeline review
   - `alert_acknowledge(eventId, metadata)` — acknowledge monitoring alert
   - `event_dismiss(eventId)` — dismiss informational notification

#### User Stories

**US-CS-1: Admin receives pipeline review request in Claude Code session (P1)**

Given an admin is running Claude Code with the companion's Channel Server active, when a pipeline step enters `waiting_review`, then a `<channel>` tag appears in the admin's session with the review details and available actions.

**US-CS-2: Admin approves review from Claude Code session (P1)**

Given a review request has been delivered via Channel, when the admin says "approve", then Claude calls the `review_decide` tool, which routes through the gateway decision endpoint, and the pipeline resumes.

**US-CS-3: Admin receives monitoring alert in Claude Code session (P2)**

Given a monitoring threshold is breached, when the admin has an active Channel Server, then the alert appears inline. The admin can acknowledge it or investigate further using their existing Claude Code tools.

**US-CS-4: Channel Server is optional — companion works without it (P0)**

Given the admin has not enabled Channels (no `--channels` flag), then the companion functions exactly as specified in Specs 001-005. No degradation, no error, no missing capability. All event delivery falls back to Slack/email/web dashboard via the gateway's other backends.

#### Dependencies

- Spec 014 Gateway Event Bus (FR-GEB-001 through FR-GEB-005) — the Channel Server subscribes to the gateway's event stream
- Spec 005 WP existing — the companion's mTLS connection and tenant authentication are prerequisites
- Claude Code Channels API stability — currently research preview; if the `notifications/claude/channel` contract changes, the Channel Server must adapt

#### Out of Scope

- Channel Server as a standalone product (it's part of the companion)
- Channels for external tenants (internal admin tool only in v1)
- Channel-based file transfer or artifact delivery (events are text notifications only)
- Custom channel plugins for third-party chat platforms (use gateway webhook delivery instead)

#### Open Questions

1. Should the Channel Server be a separate MCP server process or integrated into the companion's existing MCP server? **Recommendation**: Separate process — Channels require the `experimental/claude/channel` capability declaration, which may conflict with the companion's standard MCP capabilities.
2. Event filtering: should the Channel Server deliver ALL subscribed events or allow per-session filtering? **Recommendation**: Deliver all subscribed events in v1; add session-level filtering as a follow-up.
