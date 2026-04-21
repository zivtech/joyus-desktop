---
work_package_id: WP06
title: Integration Test Suite
dependencies: []
subtasks: [T036, T037, T038, T039, T040, T041]
history:
- date: '2026-03-19'
  event: created
authoritative_surface: ''
execution_mode: code_change
mission_id: 01KPR4E967F61H0B7K24440QG4
owned_files:
- docs/README.md
- src/*.ts
- src/a.ts
- src/b.ts
- src/components/Button.tsx
- src/components/Modal.tsx
- src/index.ts
- test/integration/**
- test/replayCache.test.ts
wp_code: WP06
---

# WP06 — Integration Test Suite

**Feature**: 006 — Managed Git Sessions
**Priority**: P1 (blocks WP07)
**Implement with**: `spec-kitty implement WP06 --base WP05`

## Objective

End-to-end integration tests covering the full pipeline: IPC event → `FileModificationDetector` → `SessionManager` (worktree creation, SQLite persistence) → `DriftDetector` → `state.driftSignal` notification. Uses real git repositories and real SQLite in temp directories. No mocks for the core pipeline — only the Tauri notification channel is stubbed.

## Context

**Existing test patterns**:
- `packages/policy-client/test/replayCache.test.ts` — real SQLite with `tmpdir`, `afterEach` cleanup
- `packages/session-manager/test/` — `vi.fn()` for execGit, but integration tests here use the real binary
- `packages/drift-detector/test/` — pure unit tests

**Integration test location**: `apps/desktop-companion/test/integration/`

**Real git setup**: Each test creates a `git init` repo in `os.tmpdir()`. The `execGit` injected into `SessionManager` and `WorktreeManager` calls the real `git` binary via `execFile`. The SQLite store uses a temp path.

**Coverage scope**: Integration tests do NOT count toward the 100% unit coverage threshold. They are run separately with `pnpm vitest run apps/desktop-companion/test/integration/`.

**Notification capture**: The `sendNotification` function injected into `sessionWiring.ts` is replaced with a `vi.fn()` that records calls — this is the only mock in the integration suite.

**Scenarios covered** (from spec.md):
- SC-001: Managed mode creates worktree on first file modification
- SC-002: Drift signal fires for multi-domain sessions
- SC-003: Stale detection and cleanup
- SC-004: Session resumption restores context
- SC-005: Advisory mode — zero auto-ops
- SC-007: Integrity scan marks missing worktrees as broken
- SC-008: Batch cleanup with partial failure

## Subtasks

### T036 — Integration Test Harness

**Purpose**: Create the shared test setup that bootstraps real git repos, real SQLite, and the full wiring stack.

**Steps**:

1. Create `apps/desktop-companion/test/integration/helpers.ts`.

2. `createTestRepo()` helper:
```typescript
export async function createTestRepo(): Promise<{ repoPath: string; cleanup: () => void }> {
  const repoPath = mkdtempSync(join(tmpdir(), 'joyus-test-'));
  await execFile('git', ['init'], { cwd: repoPath });
  await execFile('git', ['config', 'user.email', 'test@test.com'], { cwd: repoPath });
  await execFile('git', ['config', 'user.name', 'Test'], { cwd: repoPath });
  // Create initial commit so HEAD exists
  writeFileSync(join(repoPath, 'README.md'), '# test');
  await execFile('git', ['add', '.'], { cwd: repoPath });
  await execFile('git', ['commit', '-m', 'init'], { cwd: repoPath });
  return {
    repoPath,
    cleanup: () => rmSync(repoPath, { recursive: true, force: true }),
  };
}
```

3. `createTestWiring(repoPath)` helper:
```typescript
export async function createTestWiring(opts?: { pollIntervalMs?: number; staleDays?: number }) {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'joyus-db-')), 'test.db');
  const notifications: Array<{ method: string; params: unknown }> = [];
  const sendNotification = (method: string, params: unknown) => {
    notifications.push({ method, params });
  };
  const wiring = await createSessionWiring({
    sendNotification,
    dbPath,
    pollIntervalMs: opts?.pollIntervalMs ?? 60_000,
    staleDays: opts?.staleDays ?? 14,
  });
  return { wiring, notifications, dbPath };
}
```

4. `afterEach` pattern: call `wiring.shutdown()` + `cleanup()` (rm repo + db dirs).

5. Import `execFile` from `node:child_process`, `promisify` from `node:util`, `mkdtempSync`, `writeFileSync`, `rmSync` from `node:fs`, `tmpdir`, `join` from `node:os`/`node:path`.

**Files**: `apps/desktop-companion/test/integration/helpers.ts`

**Validation**:
- [ ] `createTestRepo()` returns a git repo with at least one commit
- [ ] `createTestWiring()` returns a live wiring instance with notification capture
- [ ] Cleanup removes all temp directories

---

### T037 — SC-001 to SC-004: Core Session Lifecycle

**Purpose**: Cover the primary happy-path scenarios from managed mode through drift detection and resumption.

**Test file**: `apps/desktop-companion/test/integration/sessionLifecycle.test.ts`

**SC-001 — Worktree created on first file modification**:
```
Given: managed mode, new session 'session-001', repo at tmpdir
When: wiring.detector.handleIpcEvent({ sessionId: 'session-001', repoPath, filePath: 'src/index.ts' })
Then:
  - store.findBySessionId('session-001') returns a TaskBranch with status='active'
  - TaskBranch.worktreePath exists on disk (fs.existsSync)
  - TaskBranch.branchName starts with 'joyus/'
  - No notification sent (worktree creation is silent)
```

**SC-002 — Drift signal fires when thresholds exceeded**:
```
Given: active TaskBranch for 'session-002'
When: send 6 handleIpcEvent calls spanning 3 distinct top-level directories and 2 topic domains:
  - 'src/components/Button.tsx' (frontend)
  - 'src/components/Modal.tsx'  (frontend)
  - 'api/routes/users.ts'       (backend)
  - 'api/routes/orders.ts'      (backend)
  - 'docs/README.md'            (documentation)
  - 'config/env.ts'             (configuration)
Then:
  - notifications contains at least one { method: 'state.driftSignal', params: { ... } }
  - params.confidence is 'high' (3+ dirs AND 2+ domains)
  - params.taskBranchId matches the active TaskBranch id
```

**SC-003 — Stale detection and cleanup**:
```
Given: active TaskBranch with lastActivityAt set to 15 days ago (direct DB manipulation)
When: sessionManager.initialize() called (which triggers applyStaleThreshold with 14-day cutoff)
Then:
  - TaskBranch.status === 'stale'
  - Calling session_delete on the stale branch succeeds
  - Worktree directory removed from disk
```

**SC-004 — Session resumption restores context**:
```
Given: active TaskBranch for 'session-004'
When: sessionManager.resume(taskBranchId)
Then:
  - Returned TaskBranch has status='active'
  - No new worktree created (same worktreePath)
  - polling restarted for the session (stopPolling + startPolling called internally)
```

**Files**: `apps/desktop-companion/test/integration/sessionLifecycle.test.ts`

**Validation**:
- [ ] SC-001: worktree exists on disk
- [ ] SC-002: drift signal emitted with correct confidence
- [ ] SC-003: stale transition + delete cleans up disk
- [ ] SC-004: resume returns updated TaskBranch without duplicate worktrees

---

### T038 — SC-005: Advisory Mode Exhaustive Negative Test

**Purpose**: Verify that advisory mode produces zero automatic operations across all code paths.

**Test file**: `apps/desktop-companion/test/integration/advisoryMode.test.ts`

**Steps**:

1. `createTestWiring()` with managed mode, then call `sessionManager.setMode('advisory')`.

2. Fire `handleIpcEvent` 10 times with various file paths across different directories/domains.

3. Assert **all** of the following remain true after all events:
   - `store.listAll()` returns empty array (no TaskBranch created)
   - `store.findBySessionId(sessionId)` returns `undefined`
   - No worktree directories created under `repoPath/.joyus-worktrees/`
   - `notifications` array is empty (no drift signals sent)

4. Verify `getMode()` returns `'advisory'` at the end.

5. Additional: call `sessionManager.resume(nonExistentId)` → throws `SessionNotFoundError`. This verifies the error typing works in advisory context too.

6. Verify `session.list` still returns empty (not a crash):
   - `store.listAll()` → `[]`

**Files**: `apps/desktop-companion/test/integration/advisoryMode.test.ts`

**Validation**:
- [ ] 10 IPC events → 0 TaskBranches created
- [ ] 0 worktree directories on disk
- [ ] 0 notifications sent
- [ ] `getMode()` returns `'advisory'`

---

### T039 — SC-007 Integrity Scan + SC-008 Batch Cleanup

**Purpose**: Verify that startup integrity scan correctly identifies missing worktrees, and batch cleanup handles partial failures gracefully.

**Test file**: `apps/desktop-companion/test/integration/integrityAndCleanup.test.ts`

**SC-007 — Integrity scan marks broken worktrees**:
```
Steps:
1. Create a TaskBranch with a real worktree (SC-001 pattern)
2. Manually delete the worktree directory from disk (rmSync)
3. Call sessionManager.initialize() (which runs scanIntegrity)
4. Assert TaskBranch.status === 'broken'
5. Assert that a second call to sessionManager.initialize() does not throw
   (idempotent — 'broken' records are skipped)
```

**SC-008 — Batch cleanup with injected partial failure**:
```
Steps:
1. Create 3 stale TaskBranches (A, B, C)
2. For TaskBranch B: delete the worktree path from disk first
   (simulates a partially-failed prior cleanup)
3. Call sessionManager.delete() for each in sequence:
   - A: succeeds (clean worktree)
   - B: worktreeManager.remove() is idempotent (already gone) — should succeed
   - C: succeeds (clean worktree)
4. Assert all three end up soft-deleted in store
5. Assert store.listAll() returns empty
```

**Additional: SC-007 with broken in managed mode**:
```
Given: broken TaskBranch
When: sessionManager.resume(taskBranchId)
Then: throws SessionBrokenError
```

**Files**: `apps/desktop-companion/test/integration/integrityAndCleanup.test.ts`

**Validation**:
- [ ] Missing worktree → status `'broken'` after `initialize()`
- [ ] `initialize()` is idempotent on already-broken records
- [ ] Batch delete with missing worktree succeeds (idempotent remove)
- [ ] Resume of broken TaskBranch throws `SessionBrokenError`

---

### T040 — Concurrent Session Isolation (FR-016)

**Purpose**: Verify that two simultaneous sessions in the same repo get distinct, non-colliding worktrees.

**Test file**: `apps/desktop-companion/test/integration/concurrentSessions.test.ts`

**Steps**:

1. Create one repo and one `createTestWiring()` instance.

2. Fire two `handleIpcEvent` calls concurrently (using `Promise.all`):
```typescript
await Promise.all([
  wiring.detector.handleIpcEvent({ sessionId: 'session-A', repoPath, filePath: 'src/a.ts' }),
  wiring.detector.handleIpcEvent({ sessionId: 'session-B', repoPath, filePath: 'src/b.ts' }),
]);
```

Wait for async operations to settle.

3. Assert:
   - `store.listAll()` returns exactly 2 TaskBranches
   - Each has a distinct `worktreePath`
   - Each has a distinct `branchName`
   - Both worktree paths exist on disk
   - `branchA.sessionId === 'session-A'`, `branchB.sessionId === 'session-B'`

4. Additional: fire a third event for `session-A` with a different file path:
   - Assert `store.findBySessionId('session-A').lastActivityAt` is updated
   - Assert no new TaskBranch created (still 2 total)

5. Name collision scenario: two sessions that would produce the same mission slug:
   - Both sessions touch only `src/*.ts` files → same inferred mission slug
   - Assert the second worktree gets a `-2` suffix in its branch name

**Files**: `apps/desktop-companion/test/integration/concurrentSessions.test.ts`

**Validation**:
- [ ] 2 concurrent events → 2 distinct TaskBranches
- [ ] Both worktrees exist on disk with different paths
- [ ] Second event for same session → `updateActivity` only (no new worktree)
- [ ] Name collision → `-2` suffix appended

---

### T041 — Mode-Switch Boundary + Stale Threshold Live-Update

**Purpose**: Verify that mode changes affect only new sessions, and that stale threshold applies correctly at boundary conditions.

**Test file**: `apps/desktop-companion/test/integration/modeSwitchAndStale.test.ts`

**Mode-switch boundary**:
```
Steps:
1. Start in managed mode; create TaskBranch for 'session-X' (worktree created)
2. Switch to advisory mode: sessionManager.setMode('advisory')
3. Fire handleIpcEvent for a new session 'session-Y'
4. Assert session-Y has NO TaskBranch (advisory — no auto-creation)
5. Assert session-X TaskBranch still exists and is unchanged (existing sessions unaffected)
6. Switch back to managed mode
7. Fire handleIpcEvent for 'session-Z'
8. Assert session-Z has a TaskBranch (managed again)
```

**Stale threshold boundary**:
```
Steps:
1. Create two TaskBranches:
   - Branch A: lastActivityAt = now - 13 days (NOT stale yet)
   - Branch B: lastActivityAt = now - 15 days (IS stale)
2. Call store.applyStaleThreshold(now - 14 * 24 * 60 * 60 * 1000)
3. Assert:
   - Branch A: status === 'active' (not crossed threshold)
   - Branch B: status === 'stale' (crossed threshold)
4. Verify merged and broken branches are unaffected:
   - Branch C (merged): status stays 'merged'
   - Branch D (broken): status stays 'broken'
```

**Files**: `apps/desktop-companion/test/integration/modeSwitchAndStale.test.ts`

**Validation**:
- [ ] Mode switch: session created before switch retains original mode behavior
- [ ] Mode switch: new session after switch obeys new mode
- [ ] Stale threshold: at-boundary not triggered (13d < 14d cutoff)
- [ ] Stale threshold: does not affect merged/broken records

## Definition of Done

- [ ] Integration test helpers in `apps/desktop-companion/test/integration/helpers.ts`
- [ ] 5 test files covering SC-001 through SC-008, concurrent isolation, and mode-switch boundary
- [ ] All tests pass with real git binary and real SQLite
- [ ] No mocks except `sendNotification` capture
- [ ] Tests run independently: `pnpm vitest run apps/desktop-companion/test/integration/`
- [ ] `pnpm typecheck` passes

## Risks

- **git binary on PATH**: Integration tests require `git` to be on PATH. If running in CI without git, tests will fail. Add a `beforeAll` guard that skips the suite if `git --version` fails.
- **Async settlement**: `handleIpcEvent` triggers async DB writes and worktree creation. After firing events, use a polling helper (`vi.waitFor(() => store.listAll().length === N)`) or add `await new Promise(r => setImmediate(r))` to let async work settle before asserting.
- **Concurrent git operations**: `git worktree add` is not concurrency-safe. If two sessions race, one may fail with a name collision error. The worktree manager handles this with retry + counter. Tests should use `Promise.all` + wait for both to resolve, not fire-and-forget.
- **tmpdir cleanup**: Always clean up in `afterEach` — leaked worktree directories accumulate quickly and can cause false positives in subsequent runs.

## Activity Log

- 2026-03-19T00:00:00Z – spec-kitty – lane=planned – Work package created
