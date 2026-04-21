---
work_package_id: WP07
title: Pilot Readiness Gate
dependencies: []
base_branch: 005-live-control-plane-integration-WP06
base_commit: 13795c3808c625c0dd492ff75063300584576c26
created_at: '2026-03-19T12:19:04.956670+00:00'
subtasks: [T035, T036, T037, T038]
history:
- date: '2026-03-18'
  event: created
authoritative_surface: ''
execution_mode: code_change
mission_id: 01KPR4E967F61H0B7K24440QG3
owned_files:
- docs/operations/incident-runbook-005.md
- test/integration/pilot-acceptance.test.ts
wp_code: WP07
---

# WP07 — Pilot Readiness Gate

**Feature**: 005 — Live Control Plane Integration & Pilot Readiness
**Priority**: P1
**Implement with**: `spec-kitty implement WP07 --base WP06`

## Objective

Operational readiness artifacts: alert definitions, incident runbook, and acceptance tests
covering SC-001 through SC-008. This is the sign-off gate before pilot launch.

## Context

**New files**:
- `docs/operations/incident-runbook-005.md` — alert definitions + incident runbook
- `apps/desktop-companion/test/integration/pilot-acceptance.test.ts` — acceptance tests

Acceptance tests run against MSW by default. Set `JOYUS_PILOT_STAGING_URL` to switch to
a live staging control plane for manual validation.

## Subtasks

### T035 — Alert definitions

**Purpose**: Define operational alerts for the pilot so the on-call team knows when to act.

**Steps**:

1. Write alert definitions in `docs/operations/incident-runbook-005.md` covering:

   **Alert 1: Policy Failure Rate**
   - Condition: >5% of policy decisions result in error (non-2xx or timeout) in any 5-minute window
   - Severity: P1 (page on-call)
   - Action: Check control plane health; if outage, companion continues fail-closed

   **Alert 2: Replay Attempt Detected**
   - Condition: Any `policy.replay` event received by `/v1/events`
   - Severity: P0 (immediate investigation — potential security incident)
   - Action: Investigate source JTI; check for companion duplication or token theft

   **Alert 3: Policy Latency p95 > 2s**
   - Condition: 95th percentile decision latency exceeds 2 seconds in a 5-minute window
   - Severity: P2 (warn)
   - Action: Check network connectivity between companion and control plane; review retry logs

2. For each alert, include:
   - Metric/signal being measured
   - Threshold and evaluation window
   - Severity level
   - Immediate response steps

**Files**: `docs/operations/incident-runbook-005.md`

**Validation**:
- [ ] All three alert definitions present with thresholds
- [ ] Each alert has severity and response steps

---

### T036 — Incident runbook

**Purpose**: Step-by-step runbook for simulating, detecting, and recovering from each alert scenario.

**Steps**:

1. Write runbook sections in `docs/operations/incident-runbook-005.md` for each scenario:

   **Scenario A: Control Plane Outage**
   - Simulate: bring down joyus-ai staging API
   - Verify: companion blocks actions (fail-closed), alert fires
   - Remediate: restore joyus-ai API
   - Verify recovery: companion resumes enforcement within 1 retry cycle (no restart needed)

   **Scenario B: Replay Attack Simulation**
   - Simulate: replay a previously-consumed JTI (use test tooling)
   - Verify: replay rejected, P0 alert fires, event logged to `/v1/events`
   - Remediate: investigate JTI source; rotate affected tokens if needed

   **Scenario C: High Latency**
   - Simulate: introduce artificial delay to control plane (network throttle or stub)
   - Verify: p95 latency alert fires at 2s threshold
   - Remediate: check network path; consider retry backoff tuning

2. Include a **Pre-Pilot Checklist** section:
   - [ ] `JOYUS_API_URL` set in companion config
   - [ ] `JOYUS_API_TOKEN` present and valid
   - [ ] mTLS cert paths configured (if required by ops team)
   - [ ] `pnpm ci` passes
   - [ ] Replay cache DB path writable (`~/.joyus/replay-cache.db`)
   - [ ] Alert rules deployed to monitoring system
   - [ ] Runbook walkthrough completed by on-call engineer

**Files**: `docs/operations/incident-runbook-005.md`

**Validation**:
- [ ] All three scenarios have simulate/verify/remediate/recover steps
- [ ] Pre-Pilot Checklist present
- [ ] Runbook is actionable without needing to read the spec

---

### T037 — Acceptance tests (SC-001 through SC-008)

**Purpose**: Formal acceptance tests mapping each spec scenario to a test case.

**Test file**: `apps/desktop-companion/test/integration/pilot-acceptance.test.ts`

**Steps**:

1. Use environment flag to switch between MSW and live staging:
```typescript
const BASE_URL = process.env['JOYUS_PILOT_STAGING_URL'] ?? 'http://localhost:9999';
const useMsw = !process.env['JOYUS_PILOT_STAGING_URL'];
```

2. Map each spec scenario to a test:

```typescript
describe('SC-001: Policy decision produces signed token', () => {
  it('allow decision returns token with valid jti and expiry')
});

describe('SC-002: Replay rejection', () => {
  it('reused JTI is rejected and replay event emitted')
});

describe('SC-003: Artifact provenance queryable', () => {
  it('artifact registered via handoff is queryable by jti')
});

describe('SC-004: External tenant remote workspace enforcement', () => {
  it('external tenant action is routed to remote workspace')
});

describe('SC-005: Fail-closed on outage', () => {
  it('control plane timeout blocks action (not bypasses)')
});

describe('SC-006: Recovery without restart', () => {
  it('enforcement resumes after control plane recovers')
});

describe('SC-007: Internal pilot (3-5 users)', () => {
  it('concurrent decisions from multiple action keys are independent')
});

describe('SC-008: Token refresh before expiry', () => {
  it('token is refreshed proactively at 80% TTL')
});
```

3. SC-007 and SC-008 may require timing-sensitive setup with `vi.useFakeTimers()`.

**Files**: `apps/desktop-companion/test/integration/pilot-acceptance.test.ts`

**Validation**:
- [ ] All 8 SCs have at least one test case
- [ ] Tests pass against MSW (CI)
- [ ] `JOYUS_PILOT_STAGING_URL` env flag documented in test file header comment

---

### T038 — Runbook sign-off template

**Purpose**: Provide the on-call engineer with a sign-off artifact to complete before pilot launch.

**Steps**:

1. Add a `## Sign-Off` section to `docs/operations/incident-runbook-005.md`:

```markdown
## Sign-Off

Complete this section before pilot launch. All items must be checked.

### Technical Validation
- [ ] `pnpm ci` passes on main branch
- [ ] Acceptance tests pass (`pnpm vitest run pilot-acceptance.test.ts`)
- [ ] All three runbook scenarios walked through manually on staging

### Operational Validation
- [ ] Alert definitions deployed and verified to fire
- [ ] On-call rotation aware of new P0 replay alert
- [ ] Incident runbook reviewed by at least 2 engineers

### Pilot Authorization
- Validated by: ___________
- Date: ___________
- Staging run URL (if applicable): ___________
- Notes: ___________
```

2. The sign-off section is a Markdown checklist that an engineer fills in before the pilot goes live.

**Files**: `docs/operations/incident-runbook-005.md`

**Validation**:
- [ ] Sign-off section present with checklist items
- [ ] Date and validator fields included
- [ ] Runbook is self-contained (no external lookup needed to complete sign-off)

## Definition of Done

- [ ] `docs/operations/incident-runbook-005.md` created with alert definitions, runbook, and sign-off
- [ ] `apps/desktop-companion/test/integration/pilot-acceptance.test.ts` created
- [ ] All 8 SC scenarios covered in acceptance tests
- [ ] `pnpm test` passes
- [ ] `JOYUS_PILOT_STAGING_URL` env flag documented

## Risks

- **Staging environment availability**: Acceptance tests against live staging require joyus-ai-ops to provision a staging instance. Coordinate with ops team before running `JOYUS_PILOT_STAGING_URL` tests.
- **SC-007 concurrency test**: Verifying 3–5 concurrent users requires careful test setup to avoid race conditions with shared test state. Use independent JTIs and action keys per simulated user.
- **Alert deployment**: Alert definitions in the runbook are documentation — actual deployment to the monitoring system is owned by joyus-ai-ops. Flag this dependency at pilot kickoff.

## Activity Log

- 2026-03-19T12:22:24Z – unknown – shell_pid=22048 – lane=for_review – Ready for review: incident runbook (3 alerts, 3 scenarios, pre-pilot checklist, sign-off), 15 acceptance tests covering SC-001 to SC-008, 100% coverage, 1118 tests pass
- 2026-03-19T12:25:48Z – claude – shell_pid=48414 – lane=doing – Started review via workflow command
- 2026-03-19T12:26:12Z – claude – shell_pid=48414 – lane=done – Review passed: incident runbook with 3 alerts/3 scenarios/pre-pilot checklist/sign-off; 15 acceptance tests covering all 8 SCs including concurrency (SC-007) and 80% TTL refresh (SC-008)
