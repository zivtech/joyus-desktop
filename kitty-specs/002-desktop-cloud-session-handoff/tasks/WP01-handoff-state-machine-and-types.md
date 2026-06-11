---
work_package_id: WP01
title: Handoff State Machine & Types
dependencies: []
subtasks:
- T001
- T002
- T003
- T004
phase: Phase 1 - Foundation
history:
- timestamp: '2026-03-10T15:13:40Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
authoritative_surface: ''
execution_mode: code_change
mission_id: 01KPR4E966V9S8Q9N5DG5R4DK1
owned_files:
- kitty-specs/002-desktop-cloud-session-handoff/research/data-model.md
- src/handoffStateMachine.test.ts
- src/handoffStateMachine.ts
- src/handoffTypes.test.ts
- src/handoffTypes.ts
- src/index.ts
wp_code: WP01
---

# Work Package Prompt: WP01 – Handoff State Machine & Types

## Implementation Command

```bash
spec-kitty implement WP01
```

No `--base` flag needed — this is the foundational WP with no dependencies.

## Review Feedback Status

**Read this first if you are implementing this task!**

- **Has review feedback?**: Check the `review_status` field above. If it says `has_feedback`, scroll to the **Review Feedback** section immediately.
- **You must address all feedback** before your work is complete.
- **Mark as acknowledged**: When you understand the feedback and begin addressing it, update `review_status: acknowledged` in the frontmatter.

---

## Review Feedback

> **Populated by `/spec-kitty.review`** – Reviewers add detailed feedback here when work needs changes.

*[This section is empty initially.]*

---

## Objectives & Success Criteria

- Define all TypeScript types for the handoff feature in `packages/policy-client/src/handoffTypes.ts`.
- Implement a handoff state machine with transition validation in `packages/policy-client/src/handoffStateMachine.ts`.
- All valid state transitions succeed; all invalid transitions throw descriptive errors.
- 100% line/function/branch/statement coverage for all new modules.
- Types compile cleanly with `pnpm typecheck`.

## Context & Constraints

- **Source of truth for types**: `kitty-specs/002-desktop-cloud-session-handoff/research/data-model.md`
- **Contract alignment**: Types must match schemas in `contracts/handoff-api.yaml` (SnapshotManifest, ArtifactReference, HandoffRequest, HandoffReceipt).
- **State machine**: States and transitions defined in data-model.md § State Machine.
- **Constitution 2.5**: 100% coverage mandatory — enforced by `pnpm coverage`.
- **Pattern reference**: Look at existing types in `packages/policy-client/src/` for naming conventions and export patterns.

## Subtasks & Detailed Guidance

### Subtask T001 – Define core handoff types

- **Purpose**: Provide the type foundation that every other WP imports.
- **File**: `packages/policy-client/src/handoffTypes.ts`
- **Steps**:
  1. Define the `HandoffState` enum (or string union):
     ```typescript
     export type HandoffState = 'initiated' | 'authorizing' | 'encrypting' | 'transferring' | 'completed' | 'failed';
     ```
  2. Define entity interfaces from data-model.md:
     - `ConversationEntry` — entry_id, role (`"user" | "assistant" | "system"`), content, timestamp, metadata?
     - `PendingAction` — action_id, action_name, risk_level (`"low" | "medium" | "high"`), target?, details?, queued_at
     - `RuntimeConfig` — execution_mode, tenant_class, local_execution_enabled, control_plane_url
     - `PolicyCacheEntry` — jti, action_name, decision (`"allow" | "deny" | "escalate"`), risk_level, token_expires_at
     - `ArtifactReference` — artifact_id, content_hash, size_bytes, content_type, label?
     - `SessionSnapshot` — snapshot_id, session_id, tenant_id, workspace_id, conversation_history, pending_actions, runtime_config, policy_cache, artifacts, integrity_signature, created_at, schema_version
     - `SnapshotManifest` — snapshot_id, total_size_bytes, chunk_count, chunk_size_bytes, artifact_count, artifacts, schema_version
     - `HandoffRequest` — handoff_id, session_id, tenant_id, workspace_id, policy_token, manifest, initiated_at
     - `HandoffReceipt` — handoff_id, cloud_session_id, status (`"completed" | "failed"`), pickup_url?, completed_at, error?
  3. Define `HandoffError` class extending `Error` with a `code` field for structured error reporting.
  4. Define constants: `DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024` (5 MiB), `SCHEMA_VERSION = "1.0"`.
- **Validation**: All optional fields use `?` (not `| undefined`). All required fields are non-optional.
- **Notes**: Use `readonly` on all interface fields to enforce immutability of snapshot data.

### Subtask T002 – Implement handoff state machine

- **Purpose**: Enforce valid state transitions and provide a reusable state manager for the orchestrator.
- **File**: `packages/policy-client/src/handoffStateMachine.ts`
- **Steps**:
  1. Define valid transitions map:
     ```typescript
     const VALID_TRANSITIONS: Record<HandoffState, HandoffState[]> = {
       initiated: ['authorizing', 'failed'],
       authorizing: ['encrypting', 'failed'],
       encrypting: ['transferring', 'failed'],
       transferring: ['completed', 'failed'],
       completed: [],
       failed: [],
     };
     ```
  2. Implement `HandoffStateMachine` class:
     - Constructor takes initial state (default: `'initiated'`).
     - `transition(to: HandoffState): void` — validates transition is allowed, updates state. Throws `HandoffError` with code `'INVALID_TRANSITION'` if not allowed.
     - `getState(): HandoffState` — returns current state.
     - `isFinal(): boolean` — returns true if state is `'completed'` or `'failed'`.
     - `canTransitionTo(to: HandoffState): boolean` — checks without throwing.
  3. Implement `createHandoffStateMachine(initialState?: HandoffState): HandoffStateMachine` factory function.
- **Edge cases**:
  - Transitioning from a final state (completed/failed) must throw.
  - Transitioning to the same state must throw (no self-loops).
  - Every non-final state can transition to `failed`.
- **Notes**: Keep the state machine pure (no side effects, no async). The orchestrator (WP07) will handle side effects.

### Subtask T003 – Write comprehensive tests

- **Purpose**: Achieve 100% coverage for types and state machine.
- **Files**:
  - `packages/policy-client/src/handoffTypes.test.ts`
  - `packages/policy-client/src/handoffStateMachine.test.ts`
- **Steps**:
  1. **Type tests** (`handoffTypes.test.ts`):
     - Verify `HandoffError` constructor sets message and code correctly.
     - Verify constants: `DEFAULT_CHUNK_SIZE === 5242880`, `SCHEMA_VERSION === "1.0"`.
     - Type-level tests: create valid objects for each interface to ensure they compile (serves as documentation).
  2. **State machine tests** (`handoffStateMachine.test.ts`):
     - **Happy path**: Walk through `initiated → authorizing → encrypting → transferring → completed`.
     - **All valid transitions individually**: Test each pair from VALID_TRANSITIONS.
     - **Invalid transitions**: Test every invalid pair (e.g., `initiated → encrypting`, `initiated → completed`, `authorizing → transferring`).
     - **Final state behavior**: `completed → *` throws, `failed → *` throws.
     - **Self-transition**: `initiated → initiated` throws.
     - **Any → failed**: Test from every non-final state.
     - **canTransitionTo**: Returns true/false without throwing.
     - **isFinal**: Returns true for completed/failed, false for others.
     - **Factory function**: Creates machine with default state and custom initial state.
  3. Run `pnpm coverage` — must show 100% lines/functions/branches/statements for both files.
- **Notes**: Use `describe`/`it` blocks with clear names. Use `expect(() => ...).toThrow()` for invalid transitions.

### Subtask T004 – Update barrel exports

- **Purpose**: Make new modules importable from the package entry point.
- **File**: `packages/policy-client/src/index.ts` (or equivalent barrel file)
- **Steps**:
  1. Add `export * from './handoffTypes';`
  2. Add `export * from './handoffStateMachine';`
  3. Verify `pnpm typecheck` passes with new exports.
- **Notes**: Check existing barrel file pattern — some projects use `index.ts`, others use package.json `exports` field.

## Test Strategy

- **Framework**: Vitest
- **Coverage**: 100% line/function/branch/statement (enforced by `pnpm coverage`)
- **Commands**:
  ```bash
  pnpm typecheck          # Type checking
  pnpm test               # Run tests
  pnpm coverage           # Run with coverage enforcement
  ```
- **Fixtures**: Create test factory functions (e.g., `createTestSnapshot()`, `createTestManifest()`) for reuse across WP01 tests and downstream WPs.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Type drift from data-model.md | Cross-reference every field against data-model.md during review |
| State machine missing transitions | Enumerate all state pairs in test matrix |
| Barrel export conflicts | Check existing exports before adding |

## Review Guidance

- Verify all entity fields from data-model.md are present with correct types.
- Verify state machine transition map matches the state diagram in data-model.md.
- Check that `HandoffError` code field enables programmatic error handling.
- Confirm 100% coverage in test output.
- Confirm `readonly` on all snapshot-related interface fields.

## Activity Log

- 2026-03-10T15:13:40Z – system – lane=planned – Prompt created.
- 2026-03-10T15:28:16Z – claude-opus – shell_pid=36405 – lane=doing – Started implementation via workflow command
