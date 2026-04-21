---
work_package_id: WP03
title: Token Refresh Service
dependencies: []
subtasks: [T011, T012, T013, T014, T015]
history:
- date: '2026-03-18'
  event: created
authoritative_surface: ''
execution_mode: code_change
mission_id: 01KPR4E967F61H0B7K24440QG3
owned_files:
- src/controlPlaneContracts.ts
- src/index.ts
- src/tokenRefresh.ts
- test/tokenRefresh.test.ts
wp_code: WP03
---

# WP03 — Token Refresh Service

**Feature**: 005 — Live Control Plane Integration & Pilot Readiness
**Priority**: P0
**Implement with**: `spec-kitty implement WP03 --base WP01`

## Objective

Build the proactive token refresh service that schedules a decision token refresh at 80%
of its TTL. Serializes concurrent refresh requests for the same action key so only one
in-flight call is made regardless of how many callers request simultaneously.

## Context

Decision tokens from `PolicyDecideResponse` have `token_expires_at` (ISO 8601 string).
The companion needs to refresh before expiry to avoid mid-action failures.

**Key types** (already in `packages/policy-client/src/controlPlaneContracts.ts`):
```typescript
interface PolicyDecideResponse {
  token: string;
  token_expires_at: string;  // ISO 8601
  jti: string;
  // ...
}
```

**New file**: `packages/policy-client/src/tokenRefresh.ts`
**Test file**: `packages/policy-client/test/tokenRefresh.test.ts`

## Subtasks

### T011 — TokenRefreshService with in-flight dedup Map

**Purpose**: Define the service structure and in-flight dedup mechanism.

**Steps**:

1. Define the interface and factory:

```typescript
export interface TokenRefreshDeps {
  /** Function that requests a new policy decision (re-calls the control plane). */
  requestDecision: (actionKey: string) => Promise<PolicyDecideResponse>;
  /** Injectable for testability. Defaults to setTimeout/clearTimeout. */
  scheduleTimer?: (fn: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  nowMs?: () => number;
}

export interface TokenRefreshService {
  /**
   * Register a fresh token for proactive refresh.
   * If a refresh for this actionKey is already scheduled, replaces it.
   */
  schedule(actionKey: string, response: PolicyDecideResponse): void;

  /**
   * Get a refreshed token for actionKey if in-flight; wait for it.
   * Returns undefined if no refresh is in progress for this key.
   */
  getInFlight(actionKey: string): Promise<PolicyDecideResponse> | undefined;

  /** Cancel all scheduled refreshes. Call on companion shutdown. */
  cancelAll(): void;
}
```

2. Internal state:
```typescript
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const inFlight = new Map<string, Promise<PolicyDecideResponse>>();
```

**Files**: `packages/policy-client/src/tokenRefresh.ts`

**Validation**:
- [ ] Factory `createTokenRefreshService(deps)` returns `TokenRefreshService`
- [ ] No timers fire until `schedule()` is called

---

### T012 — Proactive refresh scheduling at 80% TTL

**Purpose**: Schedule a refresh at 80% of the token's remaining TTL.

**Steps**:

1. In `schedule(actionKey, response)`:
   - Parse `response.token_expires_at` to epoch ms: `new Date(response.token_expires_at).getTime()`
   - Compute delay: `(expiresAtMs - nowMs()) * 0.8`
   - If delay <= 0 (token already past 80% mark): trigger refresh immediately (delay = 0)
   - Cancel any existing timer for this `actionKey` before scheduling new one
   - Call `scheduleTimer(() => triggerRefresh(actionKey), delay)`

2. `triggerRefresh(actionKey)`:
   - Creates an in-flight promise via `deps.requestDecision(actionKey)`
   - Stores it in `inFlight.set(actionKey, promise)`
   - On promise settlement: removes from `inFlight` and calls `schedule()` with new response
     to schedule the next refresh

**Files**: `packages/policy-client/src/tokenRefresh.ts`

**Validation**:
- [ ] Refresh fires at approximately 80% of TTL
- [ ] Existing timer for same actionKey is cancelled before new one scheduled
- [ ] Delay of 0 triggers refresh immediately
- [ ] After refresh completes, next refresh is re-scheduled

---

### T013 — Concurrent caller serialization via shared Promise

**Purpose**: Ensure multiple concurrent callers requesting the same action key share
one in-flight refresh request rather than making duplicate API calls.

**Steps**:

1. In `getInFlight(actionKey)`:
   - Return `inFlight.get(actionKey)` — callers await this shared promise
   - Returns `undefined` if no refresh in progress (caller should use existing token)

2. In the companion's policy decision path (wired in WP05), the pattern is:
```typescript
// Before making a privileged action:
const inFlight = tokenRefresh.getInFlight(actionKey);
if (inFlight !== undefined) {
  // Wait for in-flight refresh
  const freshResponse = await inFlight;
  return freshResponse;
}
// Otherwise use current token
```

3. This means the `inFlight` Map serves as the dedup mechanism — only `triggerRefresh`
   writes to it, and `getInFlight` reads from it.

**Files**: `packages/policy-client/src/tokenRefresh.ts`

**Validation**:
- [ ] Two concurrent `getInFlight` calls for same key return the same Promise
- [ ] Both callers receive the same resolved value
- [ ] Only one API call is made (verify via mock call count)
- [ ] After resolution, `getInFlight` returns `undefined` (entry removed)

---

### T014 — cancelAll() for shutdown

**Purpose**: Clean up all pending timers on companion shutdown to prevent
memory leaks and spurious requests after teardown.

**Steps**:

1. Implement `cancelAll()`:
   - Iterate `timers.entries()` and call `cancelTimer(handle)` for each
   - Clear `timers` map
   - Do NOT await in-flight promises — just stop scheduling new refreshes

2. After `cancelAll()`, calls to `schedule()` should be a no-op (add a guard flag `cancelled`).

**Files**: `packages/policy-client/src/tokenRefresh.ts`

**Validation**:
- [ ] `cancelAll()` clears all timers
- [ ] No refresh fires after `cancelAll()` (even if delay was 0)
- [ ] `schedule()` after `cancelAll()` is a no-op

---

### T015 — Unit tests

**Purpose**: 100% coverage for T011–T014.

**Test file**: `packages/policy-client/test/tokenRefresh.test.ts`

**Setup**: Use `vi.useFakeTimers()` to control `setTimeout` behavior:
```typescript
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
```

**Test cases**:
```typescript
// Scheduling
- schedule: fires refresh at ~80% of TTL (advance timer, verify requestDecision called)
- schedule: replaces existing timer when called again for same key
- schedule: immediate refresh when past 80% mark (delay <= 0)
- schedule: re-schedules after successful refresh

// Dedup
- getInFlight: returns undefined when no refresh in progress
- getInFlight: returns same Promise for two concurrent callers
- getInFlight: only one requestDecision call made (verify mock call count)
- getInFlight: returns undefined after refresh settles

// Failure handling
- triggerRefresh: failure removes inFlight entry
- triggerRefresh: failure does not re-schedule (avoids retry loop)

// cancelAll
- cancelAll: clears all timers (no refresh fires after)
- cancelAll: schedule() after cancelAll is no-op
```

**Validation**:
- [ ] `pnpm coverage` passes at 100% for `tokenRefresh.ts`
- [ ] `pnpm typecheck` passes

## Definition of Done

- [ ] `packages/policy-client/src/tokenRefresh.ts` created
- [ ] `packages/policy-client/test/tokenRefresh.test.ts` created
- [ ] `pnpm typecheck` passes
- [ ] `pnpm coverage` passes at 100%
- [ ] `createTokenRefreshService` exported from `packages/policy-client/src/index.ts`

## Risks

- **Timer leak in tests**: `vi.useFakeTimers()` must be restored after each test, and `cancelAll()` called in `afterEach` to prevent timer-related test pollution.
- **`exactOptionalPropertyTypes`**: `Map.get()` returns `T | undefined` — always check before use.

## Activity Log

- 2026-03-19T02:49:41Z – claude-wp03 – shell_pid=80442 – lane=doing – Started implementation via workflow command
- 2026-03-19T02:52:15Z – claude-wp03 – shell_pid=80442 – lane=for_review – Ready for review: tokenRefresh.ts with 80% TTL proactive refresh, in-flight dedup, cancelAll, 100% coverage
- 2026-03-19T11:46:19Z – claude – shell_pid=21900 – lane=doing – Started review via workflow command
- 2026-03-19T11:50:02Z – claude – shell_pid=21900 – lane=done – Review passed: 80% TTL proactive refresh, in-flight dedup via shared Promise, cancelAll shutdown. 11 tests, 100% coverage, typecheck clean. schedule() is idempotent when timer exists (by design).
