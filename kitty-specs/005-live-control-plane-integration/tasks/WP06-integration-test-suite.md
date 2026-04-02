---
work_package_id: WP06
title: Integration Test Suite
lane: done
dependencies: []
base_branch: 005-live-control-plane-integration-WP05
base_commit: f1bc883a26d59b5633bfa90df9cfd78da3c5d077
created_at: '2026-03-19T12:08:54.085829+00:00'
subtasks: [T028, T029, T030, T031, T032, T033, T034]
agent: claude
shell_pid: '46256'
review_status: approved
reviewed_by: Alex Urevick-Ackelsberg
history:
- date: '2026-03-18'
  event: created
---

# WP06 — Integration Test Suite

**Feature**: 005 — Live Control Plane Integration & Pilot Readiness
**Priority**: P0
**Implement with**: `spec-kitty implement WP06 --base WP05`

## Objective

End-to-end integration tests using MSW (Mock Service Worker) in Node.js intercept mode.
Each spec user story (SC-001 through SC-006) maps to at least one test scenario. No live
control plane required — MSW intercepts native `fetch` at the Node.js level.

## Context

**Technology**: MSW v2 Node intercept mode (`msw/node`).

```typescript
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
```

**Test files**:
- `apps/desktop-companion/test/integration/control-plane-wiring.test.ts` (T029–T034)

**MSW setup pattern**:
```typescript
const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

## Subtasks

### T028 — MSW server fixture with typed handlers

**Purpose**: Set up the shared MSW server with typed request handlers for all four endpoints.

**Steps**:

1. Create a shared test fixture or inline the MSW server with handlers for:
   - `POST /v1/policy/decide` → returns `PolicyDecideResponse`
   - `POST /v1/events` → returns `{ ok: true }`
   - `POST /v1/workspaces` → returns workspace response
   - `POST /v1/artifacts` → returns artifact response

2. Default handler factory (used in T029–T034):

```typescript
function makePolicyDecideHandler(response: Partial<PolicyDecideResponse> = {}) {
  return http.post(`${BASE_URL}/v1/policy/decide`, () => {
    return HttpResponse.json({
      token: 'tok_test',
      token_expires_at: new Date(Date.now() + 60_000).toISOString(),
      jti: randomUUID(),
      decision: 'allow',
      ...response,
    });
  });
}
```

3. Set `BASE_URL` from `process.env.JOYUS_API_URL` or a test default (e.g., `http://localhost:9999`).

**Files**: `apps/desktop-companion/test/integration/control-plane-wiring.test.ts`

**Validation**:
- [ ] MSW server starts in `beforeAll`, closes in `afterAll`
- [ ] `onUnhandledRequest: 'error'` prevents silent misses
- [ ] Default handlers return valid response shapes

---

### T029 — Policy decision round-trip (SC-001)

**Purpose**: Verify that a policy decision flows through all layers — HTTP client, token refresh,
authorization — and produces the correct allow/deny/escalate outcome.

**Test cases**:

```typescript
it('allow decision: returns allow outcome to authorization caller')
it('deny decision: throws PolicyDeniedError (or equivalent)')
it('escalate decision: routes to escalation handler')
```

**Steps**:

1. Set up MSW handler to return `decision: 'allow'`, `'deny'`, `'escalate'` for each test.
2. Call the authorization flow (or `requestPolicyDecision` via the wired `FetchLike`).
3. Assert the correct outcome reaches the caller.
4. Verify the token refresh service scheduled a refresh (token in the service's timer map).

**Files**: `apps/desktop-companion/test/integration/control-plane-wiring.test.ts`

**Validation**:
- [ ] Allow decision reaches caller unchanged
- [ ] Deny decision propagates as error/rejection
- [ ] Token refresh scheduled after allow decision

---

### T030 — Replay rejection and event emission (SC-002)

**Purpose**: Verify that a consumed JTI is detected and a replay event is emitted to `/v1/events`.

**Test cases**:

```typescript
it('first consume: JTI accepted, no replay event')
it('second consume of same JTI: throws replay error and emits event to /v1/events')
```

**Steps**:

1. Wire a real `ReplayCache` (using `tmpDbPath()` from WP02 test pattern).
2. Call handoff verification with a token (first call succeeds).
3. Call handoff verification again with the same JTI.
4. Assert:
   - Second call throws with replay error
   - `/v1/events` received a POST with `kind: 'policy.replay'` payload

**Capture emitted events** via MSW handler:
```typescript
const receivedEvents: unknown[] = [];
server.use(
  http.post(`${BASE_URL}/v1/events`, async ({ request }) => {
    receivedEvents.push(await request.json());
    return HttpResponse.json({ ok: true });
  })
);
```

**Files**: `apps/desktop-companion/test/integration/control-plane-wiring.test.ts`

**Validation**:
- [ ] First consume: ok=true, no event emitted
- [ ] Second consume: replay error thrown
- [ ] Replay event POSTed to `/v1/events` with correct JTI

---

### T031 — External tenant forced to remote workspace (SC-004)

**Purpose**: Verify that an external tenant policy decision routes the action to a remote workspace
rather than executing locally.

**Test cases**:

```typescript
it('external tenant: decision includes remote workspace, handoff initiated')
it('internal tenant: decision allows local execution path')
```

**Steps**:

1. MSW handler for `POST /v1/policy/decide` returns:
   - For external tenant token: `{ decision: 'allow', workspace: { type: 'remote', id: 'ws_ext_001' } }`
   - For internal tenant token: `{ decision: 'allow', workspace: { type: 'local' } }`

2. Assert that the authorization/handoff flow initiates workspace handoff for external,
   and skips handoff for internal.

**Files**: `apps/desktop-companion/test/integration/control-plane-wiring.test.ts`

**Validation**:
- [ ] External tenant triggers workspace routing
- [ ] Internal tenant skips remote workspace routing

---

### T032 — Control plane outage — fail-closed (SC-005)

**Purpose**: Verify that a control plane timeout triggers fail-closed behavior (action blocked),
not fail-open (action allowed).

**Test cases**:

```typescript
it('timeout: authorization throws (action blocked, not bypassed)')
it('network error: authorization throws (action blocked)')
```

**Steps**:

1. Override MSW handler to delay response past `requestTimeoutMs`:
   ```typescript
   server.use(
     http.post(`${BASE_URL}/v1/policy/decide`, async () => {
       await new Promise(resolve => setTimeout(resolve, 10_000)); // never resolves in test
       return HttpResponse.json({});
     })
   );
   ```

2. Set `requestTimeoutMs` to a small value (e.g., 50ms) in the test config.
3. Assert authorization throws `ControlPlaneTimeoutError` (not allow-by-default).

**Files**: `apps/desktop-companion/test/integration/control-plane-wiring.test.ts`

**Validation**:
- [ ] Timeout throws (not silently allows)
- [ ] Error type is `ControlPlaneTimeoutError`

---

### T033 — Outage recovery — enforcement resumes (SC-006)

**Purpose**: Verify that after a control plane outage resolves, enforcement resumes automatically
without companion restart.

**Test cases**:

```typescript
it('after outage: first call fails, second call (after recovery) succeeds')
```

**Steps**:

1. First MSW handler returns 503 (outage).
2. After retry exhaustion, assert the first call throws.
3. Override MSW handler to return 200 (recovery).
4. Assert a second authorization call succeeds with the real response.

```typescript
// Phase 1: simulate outage
server.use(http.post(`${BASE_URL}/v1/policy/decide`, () => HttpResponse.json({}, { status: 503 })));
await expect(authorizeAction(actionKey)).rejects.toThrow();

// Phase 2: simulate recovery
server.use(makePolicyDecideHandler({ decision: 'allow' }));
const result = await authorizeAction(actionKey);
expect(result.decision).toBe('allow');
```

**Files**: `apps/desktop-companion/test/integration/control-plane-wiring.test.ts`

**Validation**:
- [ ] Outage causes failure (not silent allow)
- [ ] Recovery allows subsequent calls to succeed
- [ ] No companion restart required between phases

---

### T034 — Artifact provenance registration (SC-003)

**Purpose**: Verify that artifact registration calls `/v1/artifacts` and the response is queryable.

**Test cases**:

```typescript
it('artifact registration: POSTs to /v1/artifacts with correct payload')
it('artifact provenance: GET returns registered artifact')
```

**Steps**:

1. Wire MSW handlers for `/v1/artifacts` (POST registers, GET queries).
2. Call `getArtifactProvenance()` after registering via handoff flow.
3. Assert the payload POSTed to `/v1/artifacts` matches the artifact metadata.

**Files**: `apps/desktop-companion/test/integration/control-plane-wiring.test.ts`

**Validation**:
- [ ] Artifact payload POSTed to `/v1/artifacts`
- [ ] Provenance response returned after registration

## Definition of Done

- [ ] `apps/desktop-companion/test/integration/control-plane-wiring.test.ts` created
- [ ] All 6 spec scenarios (SC-001 to SC-006) covered by at least one test
- [ ] `pnpm test` passes
- [ ] MSW server properly lifecycle-managed (no leaked handlers)

## Risks

- **MSW v2 Node intercept mode**: Requires `msw` as devDependency in `apps/desktop-companion/package.json`. Verify it's already present (WP04/WP05 may have added it), or add it.
- **Timer-based tests (T032, T033)**: Use `vi.useFakeTimers()` for timeout tests to avoid slow test runs. Restore real timers in `afterEach`.
- **Real SQLite in integration tests**: T030 uses a real `ReplayCache` with tmpdir — ensure the DB is closed in `afterEach` to prevent file handle leaks.

## Activity Log

- 2026-03-19T12:18:58Z – unknown – shell_pid=92680 – lane=for_review – Ready for review: 17 integration tests covering SC-001 to SC-006, 100% coverage maintained, all 1103 tests pass
- 2026-03-19T12:25:16Z – claude – shell_pid=46256 – lane=doing – Started review via workflow command
- 2026-03-19T12:25:44Z – claude – shell_pid=46256 – lane=done – Review passed: 17 integration tests covering SC-001 to SC-006, signal-aware timeout mock, real ReplayCache, MCP tool name verification, 100% coverage
