---
work_package_id: WP10
title: Phase 1 Verification & Rollout
lane: "doing"
dependencies: []
subtasks:
- T053
- T054
- T055
- T056
- T057
- T058
- T059
- T060
phase: Phase 1 - Cowork Distribution
assignee: ''
agent: "claude-opus"
shell_pid: "375"
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-03-10T00:00:00Z'
  lane: planned
  agent: ''
  action: Prompt generated
---

# Work Package Prompt: WP10 - Phase 1 Verification & Rollout

## Objective

Verify all Phase 1 success criteria (SC-001 through SC-005) through end-to-end testing, confirming that Cowork skill distribution, MCP connector access, CLI git sync, version pinning, and telemetry all work as specified.

## Context

All Phase 1 work packages (WP01-WP05) must be complete before this WP starts. This is the quality gate that validates the complete Cowork distribution pipeline works end-to-end across both orgs and both channels (Cowork web + CLI). Also verifies that desktop companion is NOT required for Phase 1 functionality (FR-014 negative test).

This WP is primarily verification and documentation — minimal code, mostly testing and evidence collection.

**Requirements**: SC-001 through SC-005, FR-014

## Subtasks

### T053: E2E — New Cowork user onboards, receives skills, uses cloud MCPs

**Purpose**: Validate the complete flow for the primary target user persona (non-developer in Cowork).

**Steps**:
1. Use a fresh or recently created non-admin account in Zivtech Cowork (ideally a PM).
2. Log in to Cowork.
3. Verify the assigned skill bundle is available:
   - Check for expected skills in the tools/commands list
   - Confirm bundle matches the user's role (PM Bundle for PMs)
4. Invoke a skill:
   - Choose a representative skill (e.g., proposal-critic)
   - Provide it with a test input
   - Verify it executes correctly (structured output, not generic response)
5. Use an MCP connector:
   - Ask Claude to list Jira issues (Atlassian connector)
   - Ask Claude to search Slack (Slack connector)
   - Verify real data is returned
6. Document the entire flow:
   - Timestamps for each step
   - Screenshots or session excerpts
   - Time from login to first successful skill invocation
7. Repeat with a Milk Jawn user account (CEO or Dir of Ops role).

**Files**: `docs/verification/wp10-e2e-cowork-onboarding.md`

**Validation**: New user in each org successfully uses both skills and MCPs in their first session. Total onboarding time documented. No setup required beyond logging in.

---

### T054: E2E — Developer onboards CLI, git sync works, skills available

**Purpose**: Validate the complete flow for the developer persona using Claude Code CLI.

**Steps**:
1. Start from a developer who hasn't set up skill sync (or clean up an existing setup).
2. Follow the setup guide from WP03 T017 — no additional assistance.
3. Start a Claude Code session.
4. Verify:
   - Sync hook triggered (check `.sync-metadata.json` timestamp)
   - Skills from the pinned version are available
   - Skills match the expected version
5. Invoke a developer skill (e.g., code-reviewer or drupal-planner).
6. Verify the skill executes correctly with structured output.
7. Document the flow with timestamps and evidence.

**Files**: `docs/verification/wp10-e2e-developer-onboarding.md`

**Validation**: Developer has working skills after following the setup guide. Sync ran automatically. Correct version synced.

---

### T055: Verify Cowork skills and cloud MCPs function without desktop companion (FR-014)

**Purpose**: Negative test — desktop companion is additive, not required for Phase 1 functionality.

**Steps**:
1. Ensure desktop companion is NOT installed on the test machine:
   - If installed: quit the companion, optionally uninstall
   - Verify no joyus-desktop processes running
2. Log in to Cowork as a non-admin user.
3. Invoke a distributed skill → verify it works.
4. Use a cloud MCP connector (Atlassian, Slack, or Google) → verify it works.
5. Start Claude Code CLI session → verify cloud MCPs work (if signed in).
6. Document: "All Phase 1 functionality verified working WITHOUT desktop companion."

**Files**: `docs/verification/wp10-no-desktop-required.md`

**Validation**: All Cowork skills and cloud MCPs work without desktop companion. Documented with evidence.

---

### T056: SC-001 — All target users invoke a skill in Cowork within 24h of admin config

**Purpose**: Verify the primary adoption success criterion.

**Steps**:
1. Record the timestamp when admin configuration was completed (bundles published, users assigned).
2. Create a tracking table:
   | User | Org | Role | First Skill Invocation | Time from Config | Status |
   |------|-----|------|----------------------|-----------------|--------|
3. Monitor or follow up with each target user:
   - PMs at Zivtech
   - COO at Zivtech
   - CEO at Milk Jawn
   - Dir of Ops at Milk Jawn
4. For users who haven't engaged within 12 hours: send a reminder with brief instructions.
5. Document final results at the 24-hour mark.

**Validation**: All target users (or documented exceptions with reasons) have at least one successful skill invocation within 24 hours.

---

### T057: SC-002 — Atlassian, Slack, Google MCPs functional for all org users within 48h

**Purpose**: Verify MCP connector rollout success criterion.

**Steps**:
1. Record when each connector was configured per org.
2. Test from at least one user per org for each connector:
   - Zivtech user: Atlassian → Slack → Google
   - Milk Jawn user: (applicable connectors only)
3. Document per-connector, per-org results:
   | Connector | Zivtech | Milk Jawn | Notes |
   |-----------|---------|-----------|-------|
4. Fix any connector that isn't working within the 48-hour window.
5. Document final state at 48 hours.

**Validation**: All three core connectors verified working for both orgs within 48 hours. Results documented.

---

### T058: SC-003 — CLI developer sync works without manual git (verified by 2 testers)

**Purpose**: Verify that developer skill sync requires no git knowledge.

**Steps**:
1. Confirm the 2 developers from WP03 T018 completed testing successfully.
2. Verify explicitly: neither developer used manual git commands after initial setup.
3. Verify each developer's current skill version matches the pin.
4. Collect written confirmation from each tester:
   - "I have working skill sync. I did not use any manual git commands."
5. Document tester environments and feedback.

**Validation**: 2 developers confirmed sync works without manual git. Written confirmation collected.

---

### T059: SC-004 — Admin views aggregated telemetry within 1 week of rollout

**Purpose**: Verify telemetry provides actionable admin insights.

**Steps**:
1. Allow at least 3-5 days of usage data to accumulate after rollout.
2. Generate admin usage report (using WP05 T028 report tool).
3. Verify report shows:
   - Per-user invocation counts
   - Per-skill usage ranking
   - Per-MCP connector usage
   - Per-org breakdown
   - Success/failure rates
4. Spot-check: verify data accuracy against known usage (e.g., T053 test invocations should appear).
5. Document the report with screenshots or output.

**Files**: `docs/verification/wp10-telemetry-report.md`

**Validation**: Admin can view meaningful telemetry data. Report shows expected usage patterns. Data is accurate on spot-check.

---

### T060: SC-005 — Version pin change propagates within one session restart

**Purpose**: Verify version control mechanism works across both channels.

**Steps**:
1. Ensure current pin is `v1.0.0` (or whatever the initial version is).
2. Verify a Cowork user has the current version's skills.
3. Verify a CLI developer has the current version (check `.sync-metadata.json`).
4. Create a new tag (e.g., `v1.0.1`) with a visible change:
   - Add a minor modification to one skill's prompt text
   - Tag and push
5. Update `distribution-config.json` pin to `v1.0.1`, commit, push.
6. Cowork user starts a new session → verify the updated skill text.
7. CLI developer starts a new Claude Code session → verify sync updates and the skill text matches.
8. Document propagation timing for both channels.

**Files**: `docs/verification/wp10-version-propagation.md`

**Validation**: Both Cowork and CLI users receive the updated version within one session restart. Timing documented.

## Implementation Notes

- **This WP is verification, not coding**. Output is documentation and evidence.
- **Some criteria need time**: SC-001 (24h), SC-002 (48h), SC-004 (1 week). Plan the verification timeline accordingly.
- **SC-004 may be partial**: If rollout is recent, the 1-week telemetry window may not have passed. Document current state and plan for follow-up check.
- **Evidence format**: All verification docs should include: date, tester, steps performed, evidence (screenshots/logs/session IDs), result (pass/fail), and notes.
- **Communication plan**: Prepare a brief message for target users explaining the new skills and MCP access, with a link to the OAuth guide from WP02 T011.

## Done Criteria

- [ ] E2E Cowork onboarding verified for both orgs (T053)
- [ ] E2E Developer CLI onboarding verified (T054)
- [ ] FR-014 (no desktop required) verified (T055)
- [ ] SC-001: target users invoked skills within 24h (T056)
- [ ] SC-002: core MCPs functional within 48h (T057)
- [ ] SC-003: CLI sync verified by 2 testers (T058)
- [ ] SC-004: admin telemetry report available (T059)
- [ ] SC-005: version pin propagation verified (T060)

## Risks & Edge Cases

- **User availability**: Target users may be slow to test — have a communication plan and reminders
- **Telemetry accumulation**: SC-004 needs time — may require a follow-up verification after 1 week
- **Version pin test**: Requires creating a new tag — ensure test tag doesn't disrupt production
- **Network issues during verification**: May cause false failures — retry before marking failed
- **Partial results**: Some criteria may not be fully met by verification time — document status and plan for completion

## Implementation Command

```bash
spec-kitty implement WP10 --base WP05
```

## Activity Log

- 2026-03-10: Prompt generated in planned lane.
- 2026-03-12T02:12:16Z – claude-opus – shell_pid=375 – lane=doing – Started implementation via workflow command
