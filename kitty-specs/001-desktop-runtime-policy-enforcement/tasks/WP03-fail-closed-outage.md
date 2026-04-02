---
work_package_id: WP03
title: Fail-Closed Outage Policy
lane: done
dependencies: []
subtasks:
- T006
- T007
- T008
phase: Phase 1 - Core Enforcement
assignee: ''
agent: ''
shell_pid: ''
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-03-05T00:00:00Z'
  lane: planned
  agent: codex
  action: Prompt generated
- timestamp: '2026-03-05T19:13:01Z'
  lane: done
  agent: codex
  action: Outage fail-closed matrix completed and verified (external medium/high + internal high).
---

# Work Package Prompt: WP03 - Fail-Closed Outage Policy

## Objective

Define and enforce outage behavior that blocks unsafe execution.

## Tasks

- Enforce fail-closed for external medium/high when policy unavailable.
- Enforce fail-closed for internal high when policy unavailable.
- Keep low-risk degraded behavior explicit and tested.

## Done Criteria

- Outage matrix implemented and tested.
- No unsafe bypass path.
- Coverage remains 100%.

## Activity Log

- 2026-03-05: Prompt scaffolded in planned lane.
- 2026-03-05: Added outage matrix coverage and moved to done.
