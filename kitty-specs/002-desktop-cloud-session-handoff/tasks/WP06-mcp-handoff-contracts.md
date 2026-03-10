---
work_package_id: "WP06"
subtasks:
  - "T026"
  - "T027"
  - "T028"
  - "T029"
  - "T030"
title: "MCP Handoff Contracts"
phase: "Phase 4 - Transport"
lane: "planned"
dependencies: ["WP01"]
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

# Work Package Prompt: WP06 – MCP Handoff Contracts

## Implementation Command

```bash
spec-kitty implement WP06 --base WP01
```

WP06 depends only on WP01 (types). It can run in parallel with WP05.

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

- Implement desktop-side MCP tool call wrappers for `initiate_handoff`, `complete_handoff`, and `handoff_status`.
- Wrappers correctly serialize requests and parse/validate responses per `contracts/handoff-api.yaml`.
- Reuse existing `callMcpTool` pattern from `controlPlaneContracts.ts`.
- 100% line/function/branch/statement coverage.

## Context & Constraints

- **Contract spec**: `contracts/handoff-api.yaml` defines the OpenAPI schemas for all three MCP tools.
- **Existing pattern**: `packages/policy-client/src/controlPlaneContracts.ts` already implements MCP tool call wrappers — follow the same structure.
- **Spec requirements**: FR-008 (cloud contract for receiving snapshots), FR-011 (documented control-plane interface).
- **Types from WP01**: `SnapshotManifest`, `HandoffReceipt`, `HandoffState`, `HandoffError`.

## Subtasks & Detailed Guidance

### Subtask T026 – Implement initiate_handoff wrapper

- **Purpose**: Send manifest to cloud, receive handoff_id, cloud public key, and upload URLs.
- **File**: `packages/policy-client/src/handoffContracts.ts`
- **Steps**:
  1. Import `callMcpTool` from `controlPlaneContracts.ts`.
  2. Define request/response types:
     ```typescript
     export interface InitiateHandoffRequest {
       manifest: SnapshotManifest;
       policy_token: string;
       session_id: string;
       tenant_id: string;
       workspace_id: string;
     }

     export interface InitiateHandoffResponse {
       handoff_id: string;
       cloud_public_key: string;    // Base64-encoded X25519 public key
       snapshot_upload_url: string;  // tus endpoint for snapshot chunks
       artifact_upload_urls: string[]; // Per-artifact tus endpoints
     }
     ```
  3. Implement `initiateHandoff(request: InitiateHandoffRequest): Promise<InitiateHandoffResponse>`:
     - Call `callMcpTool('initiate_handoff', request)`.
     - Validate response shape (T029).
     - Return parsed response.
- **Contract alignment**: Match the `initiate_handoff` schema in `contracts/handoff-api.yaml`.

### Subtask T027 – Implement complete_handoff wrapper

- **Purpose**: Signal all uploads are done, send desktop ephemeral public key, receive HandoffReceipt.
- **File**: `packages/policy-client/src/handoffContracts.ts`
- **Steps**:
  1. Define request/response types:
     ```typescript
     export interface CompleteHandoffRequest {
       handoff_id: string;
       desktop_ephemeral_public_key: string; // Base64-encoded
     }
     // Response is HandoffReceipt from handoffTypes.ts
     ```
  2. Implement `completeHandoff(request: CompleteHandoffRequest): Promise<HandoffReceipt>`:
     - Call `callMcpTool('complete_handoff', request)`.
     - Validate response shape.
     - Return parsed `HandoffReceipt`.
  3. Handle error receipt: if `status === 'failed'`, throw `HandoffError` with code `'HANDOFF_REJECTED'` and include `error` field.

### Subtask T028 – Implement handoff_status wrapper

- **Purpose**: Poll handoff state during transfer for progress monitoring.
- **File**: `packages/policy-client/src/handoffContracts.ts`
- **Steps**:
  1. Define response type:
     ```typescript
     export interface HandoffStatusResponse {
       handoff_id: string;
       state: HandoffState;
       message?: string;
     }
     ```
  2. Implement `getHandoffStatus(handoff_id: string): Promise<HandoffStatusResponse>`:
     - Call `callMcpTool('handoff_status', { handoff_id })`.
     - Validate response shape.
     - Return parsed status.
  3. Implement `pollHandoffStatus(handoff_id: string, options?: { interval?: number; timeout?: number; signal?: AbortSignal }): AsyncGenerator<HandoffStatusResponse>`:
     - Yield status at regular intervals.
     - Stop when state is final (completed/failed) or timeout/abort.
     - Default interval: 2 seconds. Default timeout: 60 seconds.
- **Notes**: The polling generator provides a clean async iteration interface for the orchestrator.

### Subtask T029 – Implement response parsing and validation

- **Purpose**: Validate that MCP tool responses match expected schemas before use.
- **File**: `packages/policy-client/src/handoffContracts.ts`
- **Steps**:
  1. Implement private validation functions for each response type:
     - `validateInitiateResponse(data: unknown): InitiateHandoffResponse` — check all required fields present and correctly typed.
     - `validateCompleteResponse(data: unknown): HandoffReceipt` — check all required fields.
     - `validateStatusResponse(data: unknown): HandoffStatusResponse` — check handoff_id and valid state.
  2. On validation failure: throw `HandoffError` with code `'INVALID_RESPONSE'` and description of what's wrong.
  3. Validate `cloud_public_key` is valid base64 (decodable to 32 bytes for X25519).
  4. Validate `artifact_upload_urls` length matches manifest's `artifact_count`.
- **Notes**: Defensive validation protects against control-plane bugs or version mismatches.

### Subtask T030 – Write tests for MCP tool wrappers

- **Purpose**: Achieve 100% coverage for all contract wrappers and validation.
- **File**: `packages/policy-client/src/handoffContracts.test.ts`
- **Steps**:
  1. **Mock setup**: Mock `callMcpTool` to return controlled responses.
  2. **initiate_handoff tests**:
     - Valid response → returns `InitiateHandoffResponse` with all fields.
     - Missing `handoff_id` → throws `INVALID_RESPONSE`.
     - Invalid `cloud_public_key` (not valid base64, wrong length) → throws.
     - `artifact_upload_urls` count mismatch → throws.
     - MCP call error → propagates error.
  3. **complete_handoff tests**:
     - Successful receipt → returns `HandoffReceipt`.
     - Failed receipt (`status: 'failed'`) → throws `HANDOFF_REJECTED` with error message.
     - Missing fields → throws `INVALID_RESPONSE`.
  4. **handoff_status tests**:
     - Valid status response → returns `HandoffStatusResponse`.
     - Invalid state value → throws `INVALID_RESPONSE`.
  5. **pollHandoffStatus tests**:
     - Mock returns `transferring` twice then `completed` → generator yields 3 results then stops.
     - Mock returns `failed` → generator yields 1 result then stops.
     - Timeout → generator throws after timeout.
     - Abort signal → generator throws `AbortError`.
  6. **Validation edge cases**:
     - Null response → throws.
     - Non-object response → throws.
     - Extra fields → accepted (forward compatibility).
  7. Run `pnpm coverage` — 100% required.

## Test Strategy

- **Framework**: Vitest
- **Coverage**: 100% enforced
- **Mocking**: Mock `callMcpTool` at the import level
- **Async generators**: Test `pollHandoffStatus` with async iteration

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Contract drift from handoff-api.yaml | Validate response shapes match OpenAPI schemas |
| callMcpTool API changes | Import from stable public API, pin existing patterns |
| Poll timeout races | Use AbortController for clean cancellation |

## Review Guidance

- Verify all three MCP tool wrappers match the schemas in `contracts/handoff-api.yaml`.
- Verify response validation catches missing fields, wrong types, and edge cases.
- Verify `pollHandoffStatus` correctly handles final states, timeout, and abort.
- Check that `callMcpTool` is imported from the existing module, not re-implemented.
- Confirm 100% coverage.

## Activity Log

- 2026-03-10T15:13:40Z – system – lane=planned – Prompt created.
