---
work_package_id: WP02
title: Runtime Routing Enforcement
dependencies: []
subtasks:
- T004
- T005
phase: Phase 1 - Core Enforcement
history:
- timestamp: '2026-03-05T00:00:00Z'
  lane: planned
  agent: codex
  action: Prompt generated
- timestamp: '2026-03-05T19:13:01Z'
  lane: done
  agent: codex
  action: Runtime routing enforcement completed with exhaustive matrix tests.
authoritative_surface: src/
execution_mode: code_change
mission_id: 01KPR4E966V9S8Q9N5DG5R4DK0
owned_files:
- src/**
wp_code: WP02
---

# Work Package Prompt: WP02 - Runtime Routing Enforcement

## Objective

Guarantee runtime target selection enforces external remote execution.

## Tasks

- Enforce external tenant -> remote always.
- Enforce internal local/remote based on configuration.
- Ensure exhaustive tests for routing matrix.

## Done Criteria

- No external local privileged path.
- Tests cover all routing branches.
- Coverage remains 100%.

## Activity Log

- 2026-03-05: Prompt scaffolded in planned lane.
- 2026-03-05: Completed implementation and verification; moved to done.
