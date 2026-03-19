# Work Packages: Live Control Plane Integration & Pilot Readiness
*Feature 005 — Task decomposition*

**Total**: 7 work packages, 38 subtasks
**Parallelization**: 2 layers — WP02, WP03, WP04 can all run concurrently after WP01

## Dependency Graph

```
Layer 0: WP01 (HTTP client — foundation)
Layer 1: WP02, WP03, WP04 (parallel — all depend only on WP01)
Layer 2: WP05 (companion wiring — requires WP02 + WP03 + WP04)
Layer 3: WP06 (integration tests — requires WP05)
Layer 4: WP07 (pilot readiness — requires WP06)
```

---

## Phase A: Foundation

### WP01 — Control Plane HTTP Client
**Prompt**: [`tasks/WP01-control-plane-http-client.md`](tasks/WP01-control-plane-http-client.md)
**Priority**: P0 (blocks everything) | **Dependencies**: none | **Est. ~330 lines**

Create the concrete `FetchLike` implementation backed by native `fetch`. Loads `ControlPlaneConfig` from environment variables. Enforces per-request timeout via `AbortController`. Retries on transient failures with exponential backoff. Supports mTLS via cert/key/ca paths.

**Subtasks**:
- [x] T001: Create `ControlPlaneConfig` type and `loadConfigFromEnv()` — reads env vars, throws on missing required
- [x] T002: Implement concrete `FetchLike` with native fetch and `AbortController` timeout
- [x] T003: Add retry logic — exponential backoff, retry on 5xx/network errors, stop on 4xx
- [x] T004: Add mTLS support — construct `https.Agent` from cert paths when configured
- [x] T005: Write unit tests for all four subtasks above

**Parallel opportunities**: None — foundation.
**Risks**: `node:https` Agent integration with native `fetch` requires undici `Agent` options in Node 24; verify the correct API surface before implementing.

---

## Phase B: Core Services (parallel)

### WP02 — Replay Cache
**Prompt**: [`tasks/WP02-replay-cache.md`](tasks/WP02-replay-cache.md)
**Priority**: P0 | **Dependencies**: WP01 | **Est. ~320 lines**

SQLite-backed (`node:sqlite`) JTI cache. Persists consumed decision token IDs across companion restarts to reject replay attacks.

**Subtasks**:
- [x] T006: Create SQLite schema and `openReplayCache()` factory
- [x] T007: Implement `consume()` — atomic INSERT-or-detect; returns ok/replay
- [x] T008: Implement `prune()` — deletes rows where `expires_at + 3600 < now`
- [x] T009: Implement `close()` — graceful SQLite connection shutdown
- [x] T010: Write unit tests — first consume ok, second=replay, prune, close

**Parallel opportunities**: Can run in parallel with WP03 and WP04.
**Risks**: `node:sqlite` ESM import path; verify `import { DatabaseSync } from 'node:sqlite'` works in Node 24 with `"type": "module"`. The `exactOptionalPropertyTypes` flag requires careful null handling at read boundaries.

---

### WP03 — Token Refresh Service
**Prompt**: [`tasks/WP03-token-refresh-service.md`](tasks/WP03-token-refresh-service.md)
**Priority**: P0 | **Dependencies**: WP01 | **Est. ~300 lines**

Proactive token refresh scheduled at 80% of TTL. Serializes concurrent refresh requests for the same action key via a shared in-flight Promise map.

**Subtasks**:
- [x] T011: Create `TokenRefreshService` with in-flight dedup `Map<string, Promise>`
- [x] T012: Implement proactive refresh scheduling at 80% of TTL using `setTimeout`
- [x] T013: Serialize concurrent callers — second caller awaits in-flight Promise
- [x] T014: Implement `cancelAll()` — clears all `setTimeout` handles on shutdown
- [x] T015: Write unit tests — refresh timing, dedup, failure propagation, cancelAll

**Parallel opportunities**: Can run in parallel with WP02 and WP04.
**Risks**: `exactOptionalPropertyTypes` in Map lookups; use `Map.get()` with explicit undefined checks. Timer cleanup critical on shutdown to prevent memory leaks in tests.

---

### WP04 — Async Event Emitter
**Prompt**: [`tasks/WP04-async-event-emitter.md`](tasks/WP04-async-event-emitter.md)
**Priority**: P0 | **Dependencies**: WP01 | **Est. ~360 lines**

Non-blocking emitter for `/v1/events` and `/v1/artifacts`. Queues in-memory, drains asynchronously with retry, falls back to NDJSON local log on permanent failure.

**Subtasks**:
- [x] T016: Create `AsyncEventEmitter` with typed `QueuedEvent` in-memory array
- [x] T017: Implement non-blocking `emit()` — enqueues and returns immediately
- [x] T018: Implement background drain loop with exponential backoff retries
- [x] T019: Implement NDJSON failure log on permanent failure (max attempts exceeded)
- [x] T020: Implement `flush()` — drains remaining queue synchronously on shutdown
- [x] T021: Write unit tests — emit returns immediately, retry, fallback, flush

**Parallel opportunities**: Can run in parallel with WP02 and WP03.
**Risks**: Background drain loop in tests must be cleanly teardownable. `noUncheckedIndexedAccess` requires array bounds checks on queue head access.

---

## Phase C: Wiring

### WP05 — Companion Wiring
**Prompt**: [`tasks/WP05-companion-wiring.md`](tasks/WP05-companion-wiring.md)
**Priority**: P0 | **Dependencies**: WP02, WP03, WP04 | **Est. ~380 lines**

Wire all components into the companion entry point. Inject real `FetchLike` client into `authorization.ts` and `handoffAuthorization.ts`. Register `ReplayCache.consume()` in token validation flow. Register shutdown handlers.

**Subtasks**:
- [ ] T022: Create `controlPlaneWiring.ts` — read env, construct all components, export wired instances
- [ ] T023: Inject `FetchLike` into `authorization.ts` policy decision calls
- [ ] T024: Inject `FetchLike` into `handoffAuthorization.ts` workspace/artifact calls
- [ ] T025: Register `ReplayCache.consume()` in `handoffVerification.ts` token validation
- [ ] T026: Register shutdown handlers (SIGTERM/SIGINT) calling `replayCache.close()`, `tokenRefresh.cancelAll()`, `eventEmitter.flush()`
- [ ] T027: Write unit tests — wiring constructs components, missing env throws, shutdown calls close

**Parallel opportunities**: None — requires WP02+WP03+WP04.
**Risks**: Circular dependency risk if `controlPlaneWiring.ts` imports from modules that also import policy-client. Verify import graph before implementation.

---

## Phase D: Integration Tests

### WP06 — Integration Test Suite
**Prompt**: [`tasks/WP06-integration-test-suite.md`](tasks/WP06-integration-test-suite.md)
**Priority**: P0 | **Dependencies**: WP05 | **Est. ~440 lines**

End-to-end integration tests using MSW (Node intercept mode) for all six spec user stories. No live control plane needed — MSW intercepts native `fetch`.

**Subtasks**:
- [ ] T028: Set up MSW `setupServer` fixture with typed request handlers for all four endpoints
- [ ] T029: Test: policy decision round-trip — allow/deny/escalate outcomes flow through all layers
- [ ] T030: Test: replay rejection — consumed JTI triggers replay event emission to `/v1/events`
- [ ] T031: Test: external tenant forced to remote workspace — no local execution path
- [ ] T032: Test: control plane outage — timeout triggers spec-001 fail-closed behavior
- [ ] T033: Test: outage recovery — enforcement resumes on reconnection without restart
- [ ] T034: Test: artifact provenance — `/v1/artifacts` registration produces queryable record

**Parallel opportunities**: T029-T034 are independent once T028 MSW fixture is ready.
**Risks**: MSW v2 Node intercept mode requires `server.listen()` in `beforeAll` and `server.close()` in `afterAll`. Timer-based tests (outage recovery) need `vi.useFakeTimers()` to avoid flakiness.

---

## Phase E: Pilot Readiness

### WP07 — Pilot Readiness Gate
**Prompt**: [`tasks/WP07-pilot-readiness-gate.md`](tasks/WP07-pilot-readiness-gate.md)
**Priority**: P1 | **Dependencies**: WP06 | **Est. ~300 lines**

Alert definitions, incident runbook, and acceptance tests covering SC-001 through SC-008. Operational sign-off artifact.

**Subtasks**:
- [ ] T035: Write alert definitions — policy failure rate (>5% in 5min), replay attempt (any), latency (p95 >2s)
- [ ] T036: Write incident runbook — simulate failure, verify alert, follow remediation, verify recovery
- [ ] T037: Implement `pilot-acceptance.test.ts` mapping each SC-001..SC-008 to a test case
- [ ] T038: Document runbook walkthrough sign-off template

**Parallel opportunities**: T035+T036 can run in parallel with T037.
**Risks**: Acceptance tests must be runnable against MSW (CI) and optionally against staging (manual). Use an env flag `JOYUS_PILOT_STAGING_URL` to switch between mock and live.

---

## Summary

| WP | Title | Subtasks | Est. Lines | Dependencies | Phase |
|----|-------|----------|------------|-------------|-------|
| 01 | Control Plane HTTP Client | 5 | ~330 | none | A |
| 02 | Replay Cache | 5 | ~320 | WP01 | B |
| 03 | Token Refresh Service | 5 | ~300 | WP01 | B |
| 04 | Async Event Emitter | 6 | ~360 | WP01 | B |
| 05 | Companion Wiring | 6 | ~380 | WP02, WP03, WP04 | C |
| 06 | Integration Test Suite | 7 | ~440 | WP05 | D |
| 07 | Pilot Readiness Gate | 4 | ~300 | WP06 | E |

**Total**: 38 subtasks | **Peak parallelism**: WP02+WP03+WP04 (Layer B)
**MVP scope**: WP01 → WP02 → WP05 (minimum for replay-safe live policy decisions)
