---
work_package_id: WP05
title: Companion Wiring
lane: done
dependencies: []
base_branch: 005-live-control-plane-integration-WP04
base_commit: 5d2d2a59c3310ed4e0eb74bbd7c7e2da9b13f0ac
created_at: '2026-03-19T11:54:44.033999+00:00'
subtasks: [T022, T023, T024, T025, T026, T027]
agent: claude
shell_pid: '43259'
review_status: approved
reviewed_by: Alex Urevick-Ackelsberg
history:
- date: '2026-03-18'
  event: created
---

# WP05 — Companion Wiring

**Feature**: 005 — Live Control Plane Integration & Pilot Readiness
**Priority**: P0
**Implement with**: `spec-kitty implement WP05 --base WP04`

## Objective

Wire all components (ControlPlaneClient, ReplayCache, TokenRefreshService, AsyncEventEmitter)
into the companion entry point. Inject the real `FetchLike` client into authorization flows,
register the replay cache in token validation, and register shutdown handlers.

## Context

This WP modifies existing files in `apps/desktop-companion/src/` to swap mock/stub
dependencies for the real implementations built in WP01–WP04.

**New file**: `apps/desktop-companion/src/controlPlaneWiring.ts`
**Modified files**:
- `apps/desktop-companion/src/authorization.ts` — inject real FetchLike
- `apps/desktop-companion/src/handoffAuthorization.ts` — inject real FetchLike
- `apps/desktop-companion/src/handoffVerification.ts` — register replay cache

Read each file before modifying to understand its current structure and injection points.

## Subtasks

### T022 — Create controlPlaneWiring.ts

**Purpose**: Central module that reads env, constructs all components, and exports wired instances.

**Steps**:

1. Create `apps/desktop-companion/src/controlPlaneWiring.ts`:

```typescript
import { loadConfigFromEnv, createControlPlaneClient } from '@joyus/policy-client';
import { openReplayCache } from '@joyus/policy-client';
import { createTokenRefreshService } from '@joyus/policy-client';
import { createAsyncEventEmitter } from '@joyus/policy-client';

export interface WiredComponents {
  fetch: FetchLike;
  replayCache: ReplayCache;
  tokenRefresh: TokenRefreshService;
  eventEmitter: AsyncEventEmitter;
}

export function createWiredComponents(): WiredComponents {
  const config = loadConfigFromEnv();
  const fetch = createControlPlaneClient(config);
  const replayCache = openReplayCache({
    dbPath: process.env['JOYUS_REPLAY_CACHE_PATH'] ?? '~/.joyus/replay-cache.db',
  });
  const tokenRefresh = createTokenRefreshService({
    requestDecision: (actionKey) => { /* wired in T023 */ throw new Error('not yet wired'); },
  });
  const eventEmitter = createAsyncEventEmitter({
    fetch,
    baseUrl: config.baseUrl,
  });
  return { fetch, replayCache, tokenRefresh, eventEmitter };
}
```

2. Call `replayCache.prune()` immediately after opening to clear stale entries.

3. Export a singleton `wiredComponents` created at module load time:
```typescript
export const wiredComponents = createWiredComponents();
```

**Files**: `apps/desktop-companion/src/controlPlaneWiring.ts`

**Validation**:
- [ ] Module exports `wiredComponents` singleton
- [ ] Missing required env vars (`JOYUS_API_URL`, `JOYUS_API_TOKEN`) throw at startup
- [ ] `replayCache.prune()` called during initialization

---

### T023 — Inject FetchLike into authorization.ts

**Purpose**: Replace the mock/stub FetchLike in the policy decision flow with the real client.

**Steps**:

1. Read `apps/desktop-companion/src/authorization.ts` to find where `FetchLike` is currently
   injected or stubbed.

2. Update the authorization module to accept the `FetchLike` from `wiredComponents.fetch`
   instead of a stub. The existing `FetchLike` parameter signature should remain unchanged —
   just wire the real implementation at the call site.

3. Wire `wiredComponents.tokenRefresh` to reschedule after each successful policy decision:
   ```typescript
   // After receiving PolicyDecideResponse:
   wiredComponents.tokenRefresh.schedule(actionKey, response);
   ```

4. Wire `wiredComponents.tokenRefresh.getInFlight(actionKey)` check before each decision:
   ```typescript
   const inFlight = wiredComponents.tokenRefresh.getInFlight(actionKey);
   if (inFlight !== undefined) {
     return inFlight; // use in-flight refresh result
   }
   ```

**Files**: `apps/desktop-companion/src/authorization.ts`

**Validation**:
- [ ] Policy decision calls use real `FetchLike` (not stub)
- [ ] Token refresh scheduled after each decision
- [ ] In-flight check prevents duplicate requests

---

### T024 — Inject FetchLike into handoffAuthorization.ts

**Purpose**: Replace mock/stub in workspace fetch and artifact provenance calls with real client.

**Steps**:

1. Read `apps/desktop-companion/src/handoffAuthorization.ts` to find workspace/artifact
   FetchLike injection points.

2. Update to use `wiredComponents.fetch` for:
   - `requestWorkspace()` calls
   - `getArtifactProvenance()` calls

3. Wire event emission for handoff completion:
   ```typescript
   wiredComponents.eventEmitter.emit(
     'handoff.complete',
     '/v1/events',
     { actionKey, workspaceId, timestamp: Date.now() }
   );
   ```

**Files**: `apps/desktop-companion/src/handoffAuthorization.ts`

**Validation**:
- [ ] Workspace requests use real FetchLike
- [ ] Artifact provenance uses real FetchLike
- [ ] Handoff completion event emitted

---

### T025 — Register ReplayCache.consume() in handoffVerification.ts

**Purpose**: Prevent token replay by checking JTIs against the persistent cache.

**Steps**:

1. Read `apps/desktop-companion/src/handoffVerification.ts` to find the token validation flow.

2. After token signature validation, call `replayCache.consume()`:
   ```typescript
   const result = wiredComponents.replayCache.consume({
     jti: token.jti,
     tenantId: token.tenantId,
     consumedAt: Math.floor(Date.now() / 1000),
     expiresAt: Math.floor(new Date(token.token_expires_at).getTime() / 1000),
   });

   if (!result.ok) {
     // Emit replay event, then reject
     wiredComponents.eventEmitter.emit('policy.replay', '/v1/events', {
       jti: token.jti,
       originalConsumedAt: result.originalConsumedAt,
     });
     throw new Error(`Token replay detected: jti=${token.jti}`);
   }
   ```

**Files**: `apps/desktop-companion/src/handoffVerification.ts`

**Validation**:
- [ ] First use of JTI passes verification
- [ ] Second use of same JTI throws with replay error
- [ ] Replay event emitted to `/v1/events` on detection

---

### T026 — Register shutdown handlers (SIGTERM/SIGINT)

**Purpose**: Ensure clean shutdown — flush events, close DB, cancel timers.

**Steps**:

1. In `controlPlaneWiring.ts`, add shutdown registration:

```typescript
export function registerShutdownHandlers(components: WiredComponents): void {
  async function shutdown() {
    await components.eventEmitter.flush();
    components.tokenRefresh.cancelAll();
    components.replayCache.close();
    process.exit(0);
  }

  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}
```

2. Call `registerShutdownHandlers(wiredComponents)` at module initialization.

**Files**: `apps/desktop-companion/src/controlPlaneWiring.ts`

**Validation**:
- [ ] SIGTERM triggers flush + cancelAll + close
- [ ] SIGINT triggers flush + cancelAll + close
- [ ] Shutdown order: flush events first, then cancelAll, then close DB

---

### T027 — Unit tests for wiring

**Purpose**: Verify that wiring constructs all components, missing env throws, and shutdown calls close.

**Test file**: `apps/desktop-companion/test/controlPlaneWiring.test.ts`

**Test cases**:
```typescript
// createWiredComponents
- constructs all four components when env vars present
- throws when JOYUS_API_URL missing
- throws when JOYUS_API_TOKEN missing
- calls replayCache.prune() on init

// registerShutdownHandlers
- SIGTERM calls flush, cancelAll, close in order
- SIGINT calls flush, cancelAll, close in order
```

Use `vi.fn()` mocks for all four component methods. Restore `process.env` after each test.

**Validation**:
- [ ] `pnpm typecheck` passes
- [ ] Tests cover wiring construction and shutdown

## Definition of Done

- [ ] `apps/desktop-companion/src/controlPlaneWiring.ts` created
- [ ] `authorization.ts`, `handoffAuthorization.ts`, `handoffVerification.ts` updated
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes (existing tests not broken)
- [ ] Shutdown handlers registered

## Risks

- **Circular imports**: `controlPlaneWiring.ts` must not be imported by `policy-client` packages — only by `apps/desktop-companion`. Verify import direction before writing.
- **Process.exit in tests**: Mock `process.exit` in shutdown handler tests to prevent test process from exiting.
- **Singleton initialization order**: Module-level `createWiredComponents()` runs at import time — ensure env vars are loaded before the module is imported (e.g., by dotenv).

## Activity Log

- 2026-03-19T12:08:44Z – unknown – shell_pid=62257 – lane=for_review – Ready for review: controlPlaneWiring.ts created with 100% coverage, shutdown handlers, all 4 components wired
- 2026-03-19T12:24:34Z – claude – shell_pid=43259 – lane=doing – Started review via workflow command
- 2026-03-19T12:25:12Z – claude – shell_pid=43259 – lane=done – Review passed: createWiredComponents() correctly wires all 4 components, exactOptionalPropertyTypes-safe, shutdown order flush→cancelAll→close→exit is correct, 12 tests with 100% coverage
