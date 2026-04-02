---
work_package_id: WP03
title: Policy-Gated Handoff Authorization
lane: done
dependencies: [WP01]
base_branch: 002-desktop-cloud-session-handoff-WP01
base_commit: a9a6bf7926cf3f8037515271481ea2cf3184a8fb
created_at: '2026-03-10T16:00:17.280244+00:00'
subtasks:
- T010
- T011
- T012
- T013
phase: Phase 2 - Core Capabilities
assignee: ''
agent: ''
shell_pid: '84864'
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-03-10T15:13:40Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP03 – Policy-Gated Handoff Authorization

## Implementation Command

```bash
spec-kitty implement WP03 --base WP01
```

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

- Implement `requestHandoffAuthorization()` that gates handoff on policy approval via `verify_before_action`.
- Handle all policy outcomes: `allow`, `deny`, `escalate`.
- Fail-closed on policy unavailability for all tenant classes (internal and external).
- User notification on denial or escalation with actionable reason.
- 100% line/function/branch/statement coverage.

## Context & Constraints

- **Spec requirements**: FR-002 (policy check before transmission), FR-003 (medium-risk minimum), FR-004 (block on deny/escalate with reason), FR-005 (fail-closed on unavailability for all tenants).
- **User Story 3**: Policy-gated authorization — see spec.md acceptance scenarios.
- **Existing pattern**: Reuse `verify_before_action` MCP tool call pattern from `controlPlaneContracts.ts` (Feature 001).
- **Constitution 2.3**: Security-first enforcement — session data leaving device is sensitive regardless of tenant class.

## Subtasks & Detailed Guidance

### Subtask T010 – Implement requestHandoffAuthorization

- **Purpose**: Create the policy authorization entry point for handoff.
- **File**: `apps/desktop-companion/src/handoffAuthorization.ts`
- **Steps**:
  1. Import `callMcpTool` (or equivalent) from existing `controlPlaneContracts.ts`.
  2. Import types from WP01: `HandoffError`, `HandoffState`.
  3. Define the handoff policy action descriptor:
     ```typescript
     interface HandoffPolicyAction {
       action_name: 'session_handoff';
       risk_level: 'medium';
       session_id: string;
       tenant_id: string;
       workspace_id: string;
     }
     ```
  4. Implement `requestHandoffAuthorization(params: { session_id: string; tenant_id: string; workspace_id: string; }): Promise<HandoffAuthResult>`:
     - Construct the `HandoffPolicyAction`.
     - Call `verify_before_action` via MCP tool call pattern.
     - Parse the response into `HandoffAuthResult`.
  5. Define `HandoffAuthResult`:
     ```typescript
     export type HandoffAuthResult =
       | { decision: 'allow'; policy_token: string }
       | { decision: 'deny'; reason: string }
       | { decision: 'escalate'; reason: string };
     ```
- **Notes**: Follow the same error handling pattern used in existing `controlPlaneContracts.ts` calls.

### Subtask T011 – Handle all policy outcomes

- **Purpose**: Map each policy decision to the correct handoff behavior.
- **File**: `apps/desktop-companion/src/handoffAuthorization.ts`
- **Steps**:
  1. On `allow`: Return the `policy_token` for inclusion in the `HandoffRequest`.
  2. On `deny`: Throw `HandoffError` with code `'POLICY_DENIED'` and include the denial reason.
  3. On `escalate`: Throw `HandoffError` with code `'POLICY_ESCALATED'` and include the escalation reason.
  4. Ensure error messages are user-facing (clear, actionable).
- **Notes**: The orchestrator (WP07) will catch these errors and transition the state machine to `failed`.

### Subtask T012 – Implement fail-closed on policy unavailability

- **Purpose**: Block handoff when the policy service is unreachable, regardless of tenant class.
- **File**: `apps/desktop-companion/src/handoffAuthorization.ts`
- **Steps**:
  1. Catch network errors, timeouts, and unexpected response formats from the MCP tool call.
  2. On any policy unavailability: Throw `HandoffError` with code `'POLICY_UNAVAILABLE'`.
  3. This applies to both `internal` and `external` tenant classes — no fallback to "allow by default".
  4. Log the underlying error for debugging but present a user-friendly message.
- **Edge cases**:
  - MCP tool call returns unexpected format → treat as unavailable.
  - MCP tool call times out → treat as unavailable.
  - MCP tool call returns HTTP 5xx → treat as unavailable.
- **Notes**: FR-005 is explicit: fail-closed regardless of tenant class. This is stricter than typical policy enforcement because session data leaving the device is a sensitive operation.

### Subtask T013 – Write tests for all policy branches

- **Purpose**: Achieve 100% coverage for authorization module.
- **File**: `apps/desktop-companion/src/handoffAuthorization.test.ts`
- **Steps**:
  1. **Mock setup**: Mock `callMcpTool` (or the MCP transport layer) to return controlled responses.
  2. **Test cases**:
     - `allow` response → returns `HandoffAuthResult` with `decision: 'allow'` and `policy_token`.
     - `deny` response → throws `HandoffError` with code `'POLICY_DENIED'` and reason.
     - `escalate` response → throws `HandoffError` with code `'POLICY_ESCALATED'` and reason.
     - Network error → throws `HandoffError` with code `'POLICY_UNAVAILABLE'`.
     - Timeout → throws `HandoffError` with code `'POLICY_UNAVAILABLE'`.
     - Malformed response → throws `HandoffError` with code `'POLICY_UNAVAILABLE'`.
     - Verify `action_name` is `'session_handoff'` in the outgoing request.
     - Verify `risk_level` is `'medium'` in the outgoing request.
     - Verify `session_id`, `tenant_id`, `workspace_id` are passed through.
  3. **Tenant class tests**:
     - Internal tenant + policy unavailable → fail-closed.
     - External tenant + policy unavailable → fail-closed.
  4. Run `pnpm coverage` — 100% required.
- **Notes**: These tests verify the critical security invariant that no handoff proceeds without explicit policy approval.

## Test Strategy

- **Framework**: Vitest
- **Mocking**: Mock the MCP tool call layer, not the network.
- **Coverage**: 100% enforced by `pnpm coverage`
- **Security focus**: Every deny/unavailable path must be tested — this is security-critical code.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Feature 001 API changes | Verify `callMcpTool` signature before coding; import from stable public API |
| Policy response format drift | Validate response shape; treat unexpected formats as unavailable |
| Missing fail-closed for edge cases | Test every error type (network, timeout, malformed) |

## Review Guidance

- Verify all three policy outcomes (allow, deny, escalate) are handled distinctly.
- Verify fail-closed behavior for ALL error types, not just network errors.
- Verify tenant class doesn't affect fail-closed behavior (both internal and external fail-closed).
- Check that error codes are meaningful and consistent.
- Confirm 100% coverage.

## Activity Log

- 2026-03-10T15:13:40Z – system – lane=planned – Prompt created.
