# Specification Quality Checklist: Managed Git Sessions

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-03-19
**Revised**: 2026-03-19 (v2 — post proposal-critic + qa-critic review)
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified and have associated scenarios
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes (resolved from critic review)

- **Naming collision resolved**: `Workspace` entity renamed to `TaskBranch` to avoid collision with existing `WorkspaceRecord` in `packages/policy-client`.
- **File modification detection**: Explicitly flagged as an open architecture question in Scope section. Options enumerated; resolved during planning.
- **Persistence layer acknowledged**: FR-015 introduces new SQLite store for TaskBranch metadata. Not an extension of replayCache.
- **Concurrent worktree isolation**: Added US-1 scenarios 4 and 5; FR-016 added.
- **Advisory mode negative scenarios**: US-6 expanded to 7 scenarios covering all code paths that must NOT fire automatically.
- **Merged status lifecycle**: US-5 added with 3 scenarios; FR-006 updated with full state transition map.
- **Batch cleanup partial failure**: US-4 scenario 5 added; SC-008 added.
- **LLM degradation**: US-2 scenario 7 added; FR-004 updated to mandate graceful degradation.
- **Drift thresholds**: Default values defined (3 directories, 2 topic domains, 30 minutes); SC-002 test corpus minimum defined.
- **Git terminology blocklist**: FR-007 enumerates the blocklist; SC-001 and US-1 test reference it.
- **Mode-switch behavior on resumed sessions**: FR-014 and US-3 scenario 2 clarify creation-time mode governs task branch lifecycle.
- **Branch lifecycle after deletion**: Added to Out of Scope and Edge Cases; FR-011 includes post-delete prompt.
- **App crash mid-creation**: Edge case added; FR-017 covers startup scan.
- **Remaining open items** (resolve during planning): GitHub Desktop URL protocol exact path to be verified; drift detection test corpus to be defined; file modification detection mechanism to be chosen.
