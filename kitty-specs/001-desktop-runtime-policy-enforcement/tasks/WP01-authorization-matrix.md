---
work_package_id: "WP01"
title: "Authorization Matrix Hardening"
lane: "planned"
subtasks:
  - "T001"
  - "T002"
  - "T003"
phase: "Phase 1 - Core Enforcement"
assignee: ""
agent: ""
shell_pid: ""
review_status: ""
reviewed_by: ""
history:
  - timestamp: "2026-03-05T00:00:00Z"
    lane: "planned"
    agent: "codex"
    action: "Prompt generated"
---

# Work Package Prompt: WP01 - Authorization Matrix Hardening

## Objective

Harden companion-side authorization to guarantee deterministic behavior for policy outcomes.

## Tasks

- Verify authorization logic for allow/deny/escalate.
- Ensure escalate always sets `needsApproval=true` and blocks execution.
- Ensure tests cover every branch and reason code.

## Done Criteria

- Authorization logic deterministic.
- Exhaustive tests pass.
- Coverage remains 100%.

## Activity Log

- 2026-03-05: Prompt scaffolded in planned lane.
