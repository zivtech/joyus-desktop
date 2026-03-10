---
work_package_id: "WP07"
subtasks:
  - "T031"
  - "T032"
  - "T033"
  - "T034"
  - "T035"
  - "T036"
title: "Handoff Orchestrator"
phase: "Phase 5 - Integration"
lane: "planned"
dependencies: ["WP01", "WP02", "WP03", "WP04", "WP05", "WP06"]
assignee: ""
agent: ""
shell_pid: ""
review_status: ""
reviewed_by: ""
history:
  - timestamp: "2026-03-10T15:13:40Z"
    lane: "planned"
    agent: "system"
    shell_pid: ""
    action: "Prompt generated via /spec-kitty.tasks"
---

# Work Package Prompt: WP07 – Handoff Orchestrator

## Implementation Command

```bash
spec-kitty implement WP07 --base WP05
```

WP07 depends on all prior WPs. Use WP05 as base (latest in the dependency chain that includes WP01→WP02→WP04→WP05). WP03 and WP06 must also be merged to main before implementing.

**Pre-check**: Confirm WP01, WP02, WP03, WP04, WP05, and WP06 are all in `done` lane before starting.

## Review Feedback Status

**Read this first if you are implementing this task!**

- **Has review feedback?**: Check the `review_status` field above. If it says `has_feedback`, scroll to the **Review Feedback** section immediately.
- **You must address all feedback** before your work is complete.

---

## Review Feedback

> **Populated by `/spec-kitty.review`**

*[This section is empty initially.]*

---

## Objectives & Success Criteria

- Implement the top-level handoff orchestrator that coordinates the full handoff flow: initiate → authorize → encrypt → upload → complete.
- State machine transitions at each step with proper error handling.
- Timeout management (30-second SLA awareness).
- Concurrent handoff prevention (one handoff per session at a time).
- User notification for success and all failure modes.
- 100% line/function/branch/statement coverage for all happy and error paths.

## Context & Constraints

- **Spec requirements**: SC-001 (30-second SLA), US1 (initiate handoff), US2 (cloud pickup), US3 (policy gating).
- **Dependencies**: This WP integrates all prior modules:
  - WP01: Types + state machine
  - WP02: Snapshot assembly + validation + manifest
  - WP03: Policy authorization
  - WP04: Encryption + chunking
  - WP05: tus upload client
  - WP06: MCP contracts (initiate, complete, status)
- **Edge cases from spec**: Mid-execution handoff, network interruption, token expiry, concurrent attempts, tenant mismatch.
- **Constitution 2.3**: Security-first — every error path must be handled, no silent failures.

## Subtasks & Detailed Guidance

### Subtask T031 – Implement orchestrator

- **Purpose**: Create the single entry point for the entire handoff flow.
- **File**: `apps/desktop-companion/src/handoffOrchestrator.ts`
- **Steps**:
  1. Define orchestrator interface:
     ```typescript
     export interface HandoffOptions {
       session_id: string;
       tenant_id: string;
       workspace_id: string;
       conversation_history: ConversationEntry[];
       pending_actions: PendingAction[];
       runtime_config: RuntimeConfig;
       policy_cache: PolicyCacheEntry[];
       artifacts: ArtifactReference[];
       artifactData: Map<string, Uint8Array>; // artifact_id → raw data
       timeoutMs?: number;   // Default: 30000
       onProgress?: (progress: HandoffProgress) => void;
       signal?: AbortSignal;
     }

     export interface HandoffProgress {
       state: HandoffState;
       message: string;
       percentComplete: number;
     }

     export interface HandoffResult {
       handoff_id: string;
       cloud_session_id: string;
       pickup_url?: string;
     }
     ```
  2. Implement `executeHandoff(options: HandoffOptions): Promise<HandoffResult>`:
     - Create state machine (WP01).
     - **Step 1 — Authorize**: Transition `initiated → authorizing`. Call `requestHandoffAuthorization` (WP03). On allow → transition to `encrypting`. On deny/escalate/unavailable → transition to `failed`, throw.
     - **Step 2 — Assemble & encrypt**: Transition `authorizing → encrypting`. Call `assembleAndSignSnapshot` (WP02). Call `encryptSnapshot` (WP04). Encrypt artifacts (WP04). Transition to `transferring`.
     - **Step 3 — Initiate handoff**: Call `initiateHandoff` MCP (WP06) with manifest. Receive cloud public key and upload URLs. Perform key agreement (WP04).
     - **Step 4 — Upload**: Call `uploadEncryptedSnapshot` (WP05) and `uploadArtifacts` (WP05) in parallel. Transition to `completed` on success.
     - **Step 5 — Complete**: Call `completeHandoff` MCP (WP06) with desktop ephemeral public key. Return `HandoffResult` with receipt data.
  3. Emit `HandoffProgress` events at each state transition.
- **Notes**: The ordering here is deliberate — authorization happens first (no data leaves device without policy approval), then encryption, then transfer.

### Subtask T032 – Wire state machine transitions

- **Purpose**: Ensure every orchestration step transitions the state machine correctly.
- **File**: `apps/desktop-companion/src/handoffOrchestrator.ts`
- **Steps**:
  1. Before each major step, call `stateMachine.transition(nextState)`.
  2. After each step completes, emit progress with current state.
  3. On any error, call `stateMachine.transition('failed')` before re-throwing.
  4. Verify state machine is in expected state before each transition (defensive check).
- **Edge case**: If `transition('failed')` itself throws (shouldn't happen from non-final states), catch and log but still propagate the original error.

### Subtask T033 – Implement error handling, edge cases, and user notification

- **Purpose**: Map every failure mode to an actionable user-facing message. Handle spec-defined edge cases.
- **File**: `apps/desktop-companion/src/handoffOrchestrator.ts`
- **Steps**:
  1. Define error-to-notification mapping:
     ```typescript
     const ERROR_NOTIFICATIONS: Record<string, string> = {
       POLICY_DENIED: 'Handoff was denied by your organization\'s policy.',
       POLICY_ESCALATED: 'Handoff requires additional approval. Please contact your admin.',
       POLICY_UNAVAILABLE: 'Policy service is currently unavailable. Please try again later.',
       INVALID_SNAPSHOT: 'Session data could not be prepared for handoff.',
       UPLOAD_FAILED: 'Transfer failed after multiple retries. Please try again.',
       HANDOFF_REJECTED: 'Cloud could not accept the session. Please try again.',
       TIMEOUT: 'Handoff timed out. Please try again with a smaller session.',
       CONCURRENT_HANDOFF: 'A handoff is already in progress for this session.',
       TOKEN_EXPIRED: 'Policy authorization expired during handoff. Please try again.',
       SNAPSHOT_TOO_LARGE: 'Session is too large to hand off. Try reducing conversation history.',
       TENANT_MISMATCH: 'Session tenant does not match cloud target environment.',
       ACTION_IN_PROGRESS: 'Cannot hand off while a privileged action is running. Wait for it to complete.',
     };
     ```
  2. **Edge case: Mid-execution handoff** (spec edge case 1): Before starting, check if a privileged action is mid-execution. If so, throw `HandoffError` with code `'ACTION_IN_PROGRESS'`. The user must wait for the action to complete before retrying.
  3. **Edge case: Token expiry** (spec edge case 3): After authorization succeeds and before encryption completes, re-validate the `policy_token` expiry. If expired, throw `HandoffError` with code `'TOKEN_EXPIRED'`.
  4. **Edge case: Snapshot size limit** (spec edge case 4): After manifest generation, check `total_size_bytes` against a configurable maximum (default: 100 MiB). If exceeded, throw `HandoffError` with code `'SNAPSHOT_TOO_LARGE'`.
  5. **Edge case: Tenant/workspace mismatch** (spec edge case 6): After `initiate_handoff` returns, verify the cloud target tenant/workspace matches the session's. If mismatched, throw `HandoffError` with code `'TENANT_MISMATCH'`.
  6. Wrap the entire orchestration in try/catch:
     - On `HandoffError`: Look up notification by code, emit progress with `failed` state and message.
     - On unknown error: Emit generic failure notification, log full error for debugging.
  7. Always transition state machine to `failed` on error.
  8. Re-throw the error after handling (caller may need it).

### Subtask T034 – Implement timeout management

- **Purpose**: Abort handoff if total elapsed time exceeds the configured timeout (default 30s).
- **File**: `apps/desktop-companion/src/handoffOrchestrator.ts`
- **Steps**:
  1. Create an `AbortController` at the start of `executeHandoff`.
  2. Set a timeout that calls `controller.abort()` after `timeoutMs`.
  3. Pass `controller.signal` to all sub-operations:
     - Upload config's `signal` parameter.
     - MCP calls (if they support abort).
  4. If user passes their own `signal`, link it to the internal controller (abort on either).
  5. On abort: Transition to `failed`, throw `HandoffError` with code `'TIMEOUT'`.
  6. Clear the timeout on successful completion (prevent late abort).
- **Edge cases**:
  - Timeout fires during encryption (CPU-bound) → abort won't interrupt crypto; check abort signal between steps.
  - Timeout fires during upload → tus client should respect AbortSignal.

### Subtask T035 – Implement concurrent handoff prevention

- **Purpose**: Prevent multiple simultaneous handoff attempts for the same session.
- **File**: `apps/desktop-companion/src/handoffOrchestrator.ts`
- **Steps**:
  1. Maintain a module-level `Set<string>` of active handoff session IDs (or use a `Map<string, AbortController>` for cancellation).
  2. At the start of `executeHandoff`:
     - Check if `session_id` is in the active set.
     - If yes: throw `HandoffError` with code `'CONCURRENT_HANDOFF'`.
     - If no: add to active set.
  3. In finally block: remove `session_id` from active set (regardless of success/failure).
  4. Consider thread safety: Node.js is single-threaded, so a simple Set is sufficient (no mutex needed).
- **Edge cases**:
  - Handoff fails → session_id must still be removed from active set.
  - Handoff is aborted → session_id must still be removed.

### Subtask T036 – Write tests for orchestrator

- **Purpose**: Achieve 100% coverage for all orchestration paths.
- **File**: `apps/desktop-companion/src/handoffOrchestrator.test.ts`
- **Steps**:
  1. **Mock setup**: Mock all sub-modules:
     - `requestHandoffAuthorization` (WP03)
     - `assembleAndSignSnapshot` (WP02)
     - `encryptSnapshot`, `encryptArtifact`, `performKeyAgreement` (WP04)
     - `uploadEncryptedSnapshot`, `uploadArtifacts` (WP05)
     - `initiateHandoff`, `completeHandoff` (WP06)
  2. **Happy path**:
     - All mocks return success → `HandoffResult` returned with cloud_session_id and pickup_url.
     - State machine transitions: initiated → authorizing → encrypting → transferring → completed.
     - Progress events emitted at each state.
  3. **Policy failure paths**:
     - Authorization returns deny → state transitions to failed, throws `POLICY_DENIED`.
     - Authorization returns escalate → failed, throws `POLICY_ESCALATED`.
     - Authorization unavailable → failed, throws `POLICY_UNAVAILABLE`.
  4. **Encryption failure**:
     - Encryption throws → state transitions to failed.
  5. **Upload failure**:
     - Upload throws after retries → state transitions to failed, throws `UPLOAD_FAILED`.
  6. **Complete failure**:
     - Cloud rejects → state transitions to failed, throws `HANDOFF_REJECTED`.
  7. **Timeout**:
     - Set `timeoutMs: 1` → orchestrator aborts, throws `TIMEOUT`.
  8. **Concurrent handoff**:
     - Start two handoffs with same session_id → second throws `CONCURRENT_HANDOFF`.
     - After first completes, new handoff with same session_id succeeds.
  9. **Abort signal**:
     - Pass pre-aborted signal → throws immediately.
     - Abort during upload → throws with abort error.
  10. **Edge case: mid-execution handoff**:
      - Privileged action in progress → throws `ACTION_IN_PROGRESS`.
  11. **Edge case: token expiry**:
      - Policy token expires between authorize and encrypt → throws `TOKEN_EXPIRED`.
  12. **Edge case: snapshot too large**:
      - Snapshot exceeds max size → throws `SNAPSHOT_TOO_LARGE`.
  13. **Edge case: tenant mismatch**:
      - Cloud target tenant differs from session tenant → throws `TENANT_MISMATCH`.
  14. **Error notification mapping**:
      - Each error code (including new edge case codes) maps to correct user-facing message.
  15. Run `pnpm coverage` — 100% required.
- **Notes**: This is the most complex test suite in the feature. Use `vi.useFakeTimers()` for timeout tests.

## Test Strategy

- **Framework**: Vitest
- **Coverage**: 100% enforced
- **Mocking**: Mock all sub-module imports; test orchestration logic, not sub-module internals
- **Timers**: Use `vi.useFakeTimers()` for timeout tests, `vi.useRealTimers()` for async flow tests

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Complex mock setup | Create shared mock factories for reuse across test cases |
| Timeout test flakiness | Use fake timers, not real delays |
| Error propagation gaps | Test every error code path explicitly |
| AbortController cleanup | Always clear timeout in finally block |

## Review Guidance

- Verify orchestration order matches security requirements: authorize → encrypt → transfer (never transfer before authorize).
- Verify every error path transitions state machine to `failed`.
- Verify concurrent handoff prevention works even after failures.
- Verify timeout is cleared on success (no late abort).
- Verify all progress events are emitted.
- Verify error notifications are user-facing (no raw error codes or stack traces).
- Confirm 100% coverage.

## Activity Log

- 2026-03-10T15:13:40Z – system – lane=planned – Prompt created.
