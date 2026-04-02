---
work_package_id: WP04
title: Async Event Emitter
lane: done
dependencies: []
base_branch: 005-live-control-plane-integration-WP01
base_commit: b28b769970e629fafee1594e0df98c38b40815c2
created_at: '2026-03-19T10:43:27.398574+00:00'
subtasks: [T016, T017, T018, T019, T020, T021]
agent: claude
shell_pid: '70195'
review_status: approved
reviewed_by: Alex Urevick-Ackelsberg
history:
- date: '2026-03-18'
  event: created
---

# WP04 — Async Event Emitter

**Feature**: 005 — Live Control Plane Integration & Pilot Readiness
**Priority**: P0
**Implement with**: `spec-kitty implement WP04 --base WP01`

## Objective

Build the non-blocking async event emitter that queues events in memory, drains them
asynchronously to `/v1/events` and `/v1/artifacts`, and falls back to a local NDJSON log
on permanent failure. The emit() call must never block the calling action flow.

## Context

The companion needs to report events (policy decisions, replay attempts, handoff completions)
and register artifact provenance records without adding latency to user-facing actions.

**New file**: `packages/policy-client/src/eventEmitter.ts`
**Test file**: `packages/policy-client/test/eventEmitter.test.ts`

**Key types** (from `packages/policy-client/src/controlPlaneContracts.ts`):
```typescript
// Events are POSTed to /v1/events; artifacts to /v1/artifacts
// Use the injected FetchLike for all HTTP calls
```

## Subtasks

### T016 — AsyncEventEmitter with typed QueuedEvent

**Purpose**: Define the emitter structure and the typed event queue.

**Steps**:

1. Define the public interface and factory:

```typescript
export type EventKind =
  | 'policy.decision'
  | 'policy.replay'
  | 'handoff.complete'
  | 'artifact.register';

export interface QueuedEvent {
  kind: EventKind;
  endpoint: string;   // '/v1/events' or '/v1/artifacts'
  payload: unknown;
  enqueuedAt: number; // epoch ms
  attempts: number;
}

export interface AsyncEventEmitterDeps {
  fetch: FetchLike;
  baseUrl: string;
  /** Max delivery attempts before writing to failureLog. Default: 3 */
  maxAttempts?: number;
  /** Path to write NDJSON failure log. Default: ~/.joyus/event-failures.ndjson */
  failureLogPath?: string;
  /** Injectable sleep for testability. Default: real setTimeout */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock. Default: Date.now */
  nowMs?: () => number;
}

export interface AsyncEventEmitter {
  /** Enqueue an event for async delivery. Returns immediately. */
  emit(kind: EventKind, endpoint: string, payload: unknown): void;

  /** Drain all pending events synchronously (best effort). Call on shutdown. */
  flush(): Promise<void>;
}
```

2. Internal state:
```typescript
const queue: QueuedEvent[] = [];
let draining = false;
```

**Files**: `packages/policy-client/src/eventEmitter.ts`

**Validation**:
- [ ] Factory `createAsyncEventEmitter(deps)` returns `AsyncEventEmitter`
- [ ] `queue` starts empty; no background work until first `emit()`

---

### T017 — Non-blocking emit() — enqueue and return immediately

**Purpose**: Ensure emit() has zero blocking cost on the caller.

**Steps**:

1. Implement `emit(kind, endpoint, payload)`:
   - Push `{ kind, endpoint, payload, enqueuedAt: nowMs(), attempts: 0 }` to `queue`
   - If not already draining, call `startDrain()` (fire-and-forget, no await)
   - Return immediately (no await, no Promise)

2. `startDrain()`:
   - Sets `draining = true`
   - Calls drain loop (see T018)
   - On loop completion: sets `draining = false`

**Files**: `packages/policy-client/src/eventEmitter.ts`

**Validation**:
- [ ] `emit()` returns synchronously (no Promise returned)
- [ ] Multiple `emit()` calls while draining do not start duplicate drain loops
- [ ] Events are pushed to queue before returning

---

### T018 — Background drain loop with exponential backoff

**Purpose**: Deliver queued events to the control plane with retry on transient failures.

**Steps**:

1. Drain loop processes the queue head-first:
   ```typescript
   while (queue.length > 0) {
     const event = queue[0]; // peek — noUncheckedIndexedAccess: check defined
     if (event === undefined) break;
     const success = await attemptDelivery(event);
     if (success) {
       queue.shift(); // remove head on success
     } else {
       event.attempts += 1;
       if (event.attempts >= maxAttempts) {
         await writeFallbackLog(event);
         queue.shift();
       } else {
         // backoff before retry
         await sleep(baseDelayMs * Math.pow(2, event.attempts - 1));
       }
     }
   }
   ```

2. `attemptDelivery(event)` → boolean:
   - POST to `${baseUrl}${event.endpoint}` via injected `FetchLike`
   - Returns `true` on 2xx response
   - Returns `false` on non-2xx or thrown error
   - Never throws — catches all errors

3. Base delay: 200ms (hardcoded default; not configurable to keep surface minimal).

**Files**: `packages/policy-client/src/eventEmitter.ts`

**Validation**:
- [ ] First delivery attempt on 2xx removes event from queue
- [ ] Failed attempt increments `event.attempts` and backs off
- [ ] After `maxAttempts` failures, event is removed and written to fallback log
- [ ] Drain loop processes all queued events sequentially

---

### T019 — NDJSON failure log on permanent failure

**Purpose**: Persist undeliverable events locally so they can be recovered or inspected.

**Steps**:

1. Implement `writeFallbackLog(event: QueuedEvent)`:
   - Resolve `~` in `failureLogPath` using `os.homedir()`
   - Ensure parent directory exists (`mkdirSync(dirname(path), { recursive: true })`)
   - Append a JSON line: `JSON.stringify({ ...event, failedAt: nowMs() }) + '\n'`
   - Use `appendFileSync` from `node:fs`
   - Catch any write error and log to `console.error` (don't throw — failure log writes must not crash the companion)

2. Default `failureLogPath`: `~/.joyus/event-failures.ndjson`

**Files**: `packages/policy-client/src/eventEmitter.ts`

**Validation**:
- [ ] NDJSON line written with event payload and `failedAt` timestamp
- [ ] Parent directory created if missing
- [ ] File write error does not throw (caught, logged to console.error)
- [ ] Each failed event appended as a separate JSON line

---

### T020 — flush() — drain on shutdown

**Purpose**: Deliver remaining queued events synchronously during companion shutdown.

**Steps**:

1. Implement `flush()`:
   - If queue is empty: return immediately
   - Run the drain loop to completion (same logic as T018, but awaited)
   - After loop completes, return
   - `flush()` is idempotent — calling it multiple times is safe

2. During `flush()`, treat it as a best-effort operation:
   - If a delivery attempt fails all retries, it is written to the fallback log (same as T019)
   - `flush()` does not throw even if all events fail

**Files**: `packages/policy-client/src/eventEmitter.ts`

**Validation**:
- [ ] `flush()` awaits until all queued events are processed
- [ ] `flush()` on empty queue returns immediately
- [ ] Events that exhaust retries during flush are written to fallback log
- [ ] `flush()` does not throw

---

### T021 — Unit tests

**Purpose**: 100% coverage for T016–T020.

**Test file**: `packages/policy-client/test/eventEmitter.test.ts`

**Setup**:
```typescript
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

function tmpLogPath() {
  return join(tmpdir(), `event-failures-test-${randomUUID()}.ndjson`);
}
```

Use `vi.fn()` for `fetch` and `sleep` to control delivery timing without real timers.

**Test cases**:
```typescript
// emit
- emit: returns synchronously (no await needed)
- emit: pushes event to queue
- emit: starts drain loop on first emit
- emit: does not start duplicate drain loop on concurrent emits

// drain loop
- drain: successful delivery removes event from queue
- drain: failed delivery increments attempts
- drain: backs off before retry (verify sleep called with correct delay)
- drain: after maxAttempts, writes to fallback log and removes from queue

// fallback log
- writeFallbackLog: writes NDJSON line to path
- writeFallbackLog: creates parent directory if missing
- writeFallbackLog: does not throw on file write error

// flush
- flush: empty queue returns immediately
- flush: drains all pending events
- flush: does not throw when all deliveries fail
- flush: idempotent (safe to call multiple times)
```

**Validation**:
- [ ] `pnpm coverage` passes at 100% for `eventEmitter.ts`
- [ ] `pnpm typecheck` passes

## Definition of Done

- [ ] `packages/policy-client/src/eventEmitter.ts` created
- [ ] `packages/policy-client/test/eventEmitter.test.ts` created
- [ ] `pnpm typecheck` passes
- [ ] `pnpm coverage` passes at 100%
- [ ] `createAsyncEventEmitter` exported from `packages/policy-client/src/index.ts`

## Risks

- **noUncheckedIndexedAccess on queue[0]**: Always check `queue[0] !== undefined` before accessing — TypeScript will require this.
- **Drain loop reentry**: The `draining` flag prevents concurrent drain loops; verify this in tests with multiple rapid `emit()` calls.
- **File system in tests**: Use `tmpdir()` + unique filenames to avoid test pollution; clean up after each test.

## Activity Log

- 2026-03-19T10:52:24Z – unknown – shell_pid=23453 – lane=for_review – Ready for review: async event emitter with non-blocking emit(), background drain loop, exponential backoff, NDJSON fallback log, flush() joining active drain via shared promise. 20 tests, 100% coverage, typecheck clean.
- 2026-03-19T10:56:21Z – claude – shell_pid=70195 – lane=doing – Started review via workflow command
- 2026-03-19T10:57:26Z – claude – shell_pid=70195 – lane=done – Review passed: correct types, non-blocking emit, shared drainPromise prevents concurrent loops, exponential backoff formula verified, NDJSON fallback log correct, flush() idempotent, 100% coverage, typecheck clean.
