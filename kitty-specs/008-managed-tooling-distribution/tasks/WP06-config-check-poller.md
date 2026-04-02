---
work_package_id: WP06
title: Config-Check Poller Sidecar
lane: for_review
dependencies: [WP01]
requirement_refs: [FR-010, FR-020]
planning_base_branch: feat/008-managed-tooling-distribution
merge_target_branch: feat/008-managed-tooling-distribution
branch_strategy: Planning artifacts for this feature were generated on feat/008-managed-tooling-distribution. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/008-managed-tooling-distribution unless the human explicitly redirects the landing branch.
subtasks: [T028, T029, T030, T031, T032, T033]
agent: codex
shell_pid: '77157'
history:
- date: '2026-04-01'
  event: created
  note: Generated from spec-kitty.tasks
---

# WP06: Config-Check Poller Sidecar

**Implement command**: `spec-kitty implement WP06 --base WP01`

## Objective

Implement the config-check poll loop in desktop-companion's sidecar that detects control plane config changes and triggers the sync+reconcile pipeline.

## Context

- Lives in `apps/desktop-companion/src/sidecar/configCheckPoller.ts` (alongside `usage-collector.ts`, `sessionWiring.ts`)
- Uses `setInterval` for polling — simple, reliable, no new infrastructure
- State is in-memory only (lastVersionHash, consecutiveFailures) — rebuilt on app restart
- The poller is thin: fetch → hash → compare → callback. All sync/reconcile logic is in the callback (WP07 wires this)
- Default interval: 5 minutes (300_000ms), configurable per-tenant
- Graceful degradation: network failure → log, preserve state, retry next interval

## Subtasks

### T028: Implement config-check poller

**Purpose**: Create the core poller that fetches the manifest URL on an interval.

**Steps**:
1. Create `apps/desktop-companion/src/sidecar/configCheckPoller.ts`
2. Define types from `contracts/reconciler-api.ts`:
   ```typescript
   interface ConfigCheckConfig {
     readonly manifestUrl: string;
     readonly intervalMs?: number;  // default 300_000
     readonly fetchImpl?: typeof fetch;
     readonly onChangeDetected: (manifest: DistributionManifest) => Promise<void>;
     readonly onPollError?: (error: Error) => void;
     readonly now?: () => Date;
   }
   
   interface ConfigCheckState {
     lastCheckAt?: string;
     lastChangeAt?: string;
     lastVersionHash?: string;
     consecutiveFailures: number;
   }
   
   interface PollerHandle {
     stop: () => void;
     getState: () => Readonly<ConfigCheckState>;
   }
   ```
3. Implement `startConfigCheckPoller(config: ConfigCheckConfig): PollerHandle`
4. On each interval tick: fetch manifest URL, hash response, compare to lastVersionHash

**Files**:
- `apps/desktop-companion/src/sidecar/configCheckPoller.ts` (new, ~40 lines)

---

### T029: Implement version hash comparison

**Purpose**: Determine if the manifest has changed since last check using content hashing.

**Steps**:
1. Implement internal function:
   ```typescript
   function hashManifestContent(content: string): string
   ```
2. Use `createHash("sha256").update(content).digest("hex")`
3. In the poll tick: compare hash to `state.lastVersionHash`
4. If same → no-op, update `lastCheckAt`
5. If different → trigger change detection

**Files**:
- `apps/desktop-companion/src/sidecar/configCheckPoller.ts` (extend, ~10 lines)

---

### T030: Implement change detection callback

**Purpose**: When a config change is detected, parse the manifest and invoke the callback.

**Steps**:
1. In the poll tick, when hash differs:
   a. Parse the response body as JSON
   b. Validate as DistributionManifest (using `validateManifest` from settings-reconciler)
   c. Call `config.onChangeDetected(manifest)` (awaited)
   d. On success: update `state.lastVersionHash`, `state.lastChangeAt`, reset `consecutiveFailures` to 0
   e. On callback failure: treat as error (same path as T031)

**Files**:
- `apps/desktop-companion/src/sidecar/configCheckPoller.ts` (extend, ~20 lines)

---

### T031: Implement graceful degradation on network failure

**Purpose**: Handle fetch failures without crashing or losing state.

**Steps**:
1. Wrap the fetch call in try/catch
2. On failure:
   - Increment `state.consecutiveFailures`
   - Update `state.lastCheckAt`
   - Call `config.onPollError?.(error)` if provided
   - Do NOT modify `state.lastVersionHash` (preserve last known good state)
   - Do NOT throw — the interval continues
3. On success: reset `consecutiveFailures` to 0

**Files**:
- `apps/desktop-companion/src/sidecar/configCheckPoller.ts` (extend, ~15 lines)

---

### T032: Implement poller start/stop lifecycle

**Purpose**: Clean lifecycle management — start returns a handle, stop clears the interval.

**Steps**:
1. `startConfigCheckPoller` should:
   - Run one immediate check (don't wait for first interval)
   - Set up `setInterval` with `config.intervalMs ?? 300_000`
   - Return `PollerHandle` with `stop()` and `getState()`
2. `stop()` calls `clearInterval`
3. `getState()` returns a readonly snapshot of current state
4. Calling `stop()` multiple times is safe (idempotent)

**Files**:
- `apps/desktop-companion/src/sidecar/configCheckPoller.ts` (extend, ~15 lines)

---

### T033: Tests for config-check poller

**Purpose**: Achieve 100% coverage on configCheckPoller.ts.

**Steps**:
1. Create `apps/desktop-companion/test/sidecar/configCheckPoller.test.ts`
2. Test scenarios:
   - **Unchanged manifest**: Two polls with same response → callback NOT called, lastCheckAt updated
   - **Changed manifest**: Poll with different response → callback called with parsed manifest, hash updated
   - **Network failure**: Fetch throws → onPollError called, consecutiveFailures incremented, state preserved
   - **Invalid JSON response**: Parse fails → treated as error, state preserved
   - **Invalid manifest**: Valid JSON but fails validation → treated as error
   - **Callback failure**: onChangeDetected throws → treated as error, hash NOT updated (will retry)
   - **Immediate check**: First check runs immediately on start, not after interval delay
   - **Stop**: After stop(), no more polls fire
   - **Stop idempotent**: Calling stop() twice doesn't throw
   - **getState**: Returns current state snapshot
3. Use fake timers (vitest `vi.useFakeTimers()`) to control interval timing
4. Inject mock fetch via `fetchImpl`

**Files**:
- `apps/desktop-companion/test/sidecar/configCheckPoller.test.ts` (new, ~180 lines)

**Validation**:
- [ ] All tests pass
- [ ] 100% coverage on configCheckPoller.ts

## Definition of Done

- [ ] Poller runs on configurable interval with immediate first check
- [ ] Hash comparison skips callback when unchanged
- [ ] Change detection invokes callback with validated manifest
- [ ] Network failures logged and retried (no crash)
- [ ] Clean start/stop lifecycle
- [ ] 100% test coverage

## Risks

- **Timer precision**: `setInterval` is not precise — polls may drift slightly. Acceptable for 5-minute intervals.
- **Concurrent polls**: If a poll takes longer than the interval, the next poll fires while the previous is still running. Mitigation: use a `polling` flag to skip overlapping ticks.

## Reviewer Guidance

- Verify immediate first check (don't wait 5 minutes on startup)
- Verify hash NOT updated on callback failure (ensures retry on next tick)
- Verify stop is idempotent
- Verify fake timers used correctly in tests (no real delays)

## Activity Log

- 2026-04-02T03:03:16Z – codex – shell_pid=77157 – lane=doing – Started implementation via workflow command
- 2026-04-02T03:25:25Z – codex – shell_pid=77157 – lane=for_review – Ready for review: config-check poller with SHA-256 hashing, graceful degradation, 100% coverage
