---
work_package_id: WP14
title: Operator UAT
dependencies:
- WP11
- WP12
- WP13
requirement_refs:
- FR-014
- FR-015
- FR-016
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts for this feature were generated on main. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into main unless the human explicitly redirects the landing branch.
subtasks:
- T052
history:
- date: '2026-05-10'
  event: created
  note: Generated via /spec-kitty.tasks
authoritative_surface: kitty-specs/recon-operator-01KRA2P1/tasks/WP14-operator-uat.md
execution_mode: planning_artifact
mission_id: 01KRA2P11PNXGNMMJQYQYP34M8
owned_files:
- kitty-specs/recon-operator-01KRA2P1/tasks/WP14-operator-uat.md
tags: []
wp_code: WP14
---

# WP14: Operator UAT

## Overview

Execute a full, unassisted user acceptance test session with the operator as the test subject. The goal is to verify that the complete Recon Operator feature — install, setup, engagement creation, analysis completion, scan, and export — can be completed by a target user without any assistance from the implementation team. This is a manual execution work package; no code changes are produced by the WP itself. Issues discovered here are filed and fixed before the feature is considered shippable.

**Prerequisite gate**: WP11 (signed DMG), WP12 (Readiness Matrix), and WP13 (Error Recovery) must all be merged and included in the DMG distributed for this test. Do not run UAT against an unsigned build or a build missing any of those WPs.

## Subtasks

### T052 — Execute full unassisted UAT with the operator

**Session logistics**:
- Schedule a 2-hour block with the operator. Choose a time when the operator has reliable internet access.
- Share the signed DMG and initial credentials (DataForSEO login/password, Anthropic API key) via a secure channel (1Password shared vault or equivalent). Do NOT share credentials over Slack, email, or any plaintext channel.
- Alex observes the session (screen share or recording). Alex does NOT intervene during the flow. Clarifying questions from the operator about what the software intends to do are acceptable to answer; how-to guidance is not.
- Record the session (with the operator's consent) for issue documentation.

**Test flow** — the operator executes the following steps without assistance:

1. Open the downloaded DMG and install the Desktop Companion app.
2. Launch the app and complete the setup wizard end-to-end (credential entry, skill sync, preflight check).
3. On the Recon dashboard, verify the Readiness Matrix shows all-green (or resolve any warning/blocking items using the UI alone).
4. Create a new engagement for a designated test URL (provided in the test brief — use a real but non-sensitive domain, e.g., a Zivtech client site that the operator has clearance to scan).
5. Wait for the engagement to complete (`.recon-complete` sentinel appears). This may take up to 30–60 minutes depending on site size; the operator may step away and return.
6. Review the completion status in the app.
7. Run the export and review the output zip contents.
8. Confirm no credentials or sensitive tokens appear in the exported files.

**Observation criteria**:

Alex records:
- Where the operator paused or appeared confused (timestamp + description)
- Any action the operator attempted that did not produce a visible result within 3 seconds
- Any error message the operator encountered
- Any step the operator skipped or reordered
- Overall confidence level (1–5 scale, the operator self-reports at end of session)

**Issue filing**:

After the session, file GitHub issues in this repo with the following priority labels:

- **P0** (blocks completion): Any issue that caused or would cause the operator to abandon the flow. Fix within 1–2 business days and schedule a re-test of the blocked step specifically.
- **P1** (significant confusion): the operator completed the step but only after visible hesitation, wrong-path attempts, or expressed confusion. Fix before general release.
- **P2** (minor friction / nice-to-have): Polish items that did not impede completion. Prioritize in backlog.

**Re-test protocol**:

If any P0 issues are filed: fix them, cut a new signed DMG, and re-test the specific blocked step(s) with the operator. A full re-run of T052 is only required if P0 issues affected the credential or engagement launch steps (i.e., the core happy path).

## Success Criteria

The feature is considered UAT-passed when ALL of the following are true:

- the operator completes the full flow (install through export) without Terminal access at any point after initial setup.
- Setup wizard completes in under 30 minutes (from DMG open to Readiness Matrix all-green).
- Per-engagement overhead (from "New Engagement" click to analysis running) is under 5 minutes.
- The exported zip contains zero credential strings (verified by running `scan-sensitive-output.mjs` against the zip contents).
- the operator self-reports usability of 3 or higher on a 5-point scale.
- No P0 issues remain open at session end (or re-test clears all P0 issues).

## Failure Criteria

The feature is NOT shippable if ANY of the following occur:

- the operator abandons the flow at any point and cannot be unblocked by the UI alone.
- Any credential string appears in the exported zip (automatic fail, no exceptions).
- Terminal access is required at any point after the setup wizard completes.
- The engagement completes silently with no visible status update in the Desktop app (silent failure).
- the operator self-reports usability below 3/5.
