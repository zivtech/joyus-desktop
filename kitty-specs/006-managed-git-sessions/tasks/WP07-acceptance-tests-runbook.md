---
work_package_id: WP07
title: Acceptance Tests & Runbook
lane: for_review
dependencies: []
subtasks: [T042, T043, T044, T045, T046, T047, T048]
history:
- date: '2026-03-19'
  event: created
- date: '2026-03-20'
  event: implemented
  note: All 7 artifacts delivered. 39 acceptance tests passing, 100% coverage, typecheck clean.
---

# WP07 — Acceptance Tests & Runbook

**Feature**: 006 — Managed Git Sessions
**Priority**: P2
**Implement with**: `spec-kitty implement WP07 --base WP06`

## Objective

Pilot acceptance test suite covering SC-001 through SC-008 from the spec, plus an operational runbook for the feature. These tests are written to be run by a QA engineer or CI pipeline as final acceptance gates before shipping the feature to non-technical pilot users.

## Context

**Acceptance test location**: `apps/desktop-companion/test/acceptance/`

**Runbook location**: `docs/operations/runbook-006.md`

**Running acceptance tests**:
```bash
pnpm vitest run apps/desktop-companion/test/acceptance/
```

**Relationship to integration tests**: WP06 integration tests verify internal pipeline correctness. WP07 acceptance tests verify the feature satisfies the spec's success criteria — from the user's perspective, not the implementation's.

**Spec reference**: All test scenarios map directly to `kitty-specs/006-managed-git-sessions/spec.md` acceptance scenario IDs (SC-001 through SC-008).

**Git terminology blocklist** (from spec.md FR-011): The following words must NEVER appear in any user-facing string:
`branch`, `commit`, `hash`, `HEAD`, `checkout`, `merge`, `stash`, `worktree`, `ref`, `diff`, `push`, `pull`

## Subtasks

### T042 — SC-001: Git Terminology Blocklist Sweep

**Purpose**: Assert that no word from the git terminology blocklist appears in any user-facing string rendered by the Sessions page.

**Test file**: `apps/desktop-companion/test/acceptance/terminologyBlocklist.test.ts`

**Steps**:

1. Import the rendered output of all user-facing components:
   - `TaskBranchCard` — status labels, button labels, warning messages
   - `DriftBanner` — all text variants (low + high confidence)
   - `Sessions.tsx` — page title, section headings, empty state, batch cleanup result, mode toggle labels

2. Define blocklist:
```typescript
const GIT_BLOCKLIST = [
  'branch', 'commit', 'hash', 'HEAD', 'checkout',
  'merge', 'stash', 'worktree', 'ref', 'diff', 'push', 'pull',
] as const;
```

3. For each string literal used in user-facing components, assert it does not contain any blocklist word (case-insensitive):
```typescript
function assertNoGitTerms(text: string, source: string): void {
  for (const term of GIT_BLOCKLIST) {
    expect(
      text.toLowerCase(),
      `"${term}" found in user-facing text from ${source}`
    ).not.toContain(term);
  }
}
```

4. **Render-based check**: Use React Testing Library to render each component with representative props (all `TaskBranchStatus` values, both drift confidence levels), then scan `document.body.textContent` for blocklist terms.

5. **String constant check**: Extract all string literals from `TaskBranchCard.tsx`, `DriftBanner.tsx`, and `Sessions.tsx` and assert each against the blocklist. This catches strings that don't render in the test scenarios.

6. Edge case: the word "branch" may appear in the GitHub Desktop URL scheme (`x-github-client://openRepo/...`) — this is an internal URL, not user-visible text. Assert the URL is never rendered as visible text.

**Files**: `apps/desktop-companion/test/acceptance/terminologyBlocklist.test.ts`

**Validation**:
- [ ] All 4 status label strings pass blocklist check
- [ ] All button labels pass
- [ ] All DriftBanner text variants pass
- [ ] Mode toggle labels pass
- [ ] GitHub Desktop URL not rendered as visible text

---

### T043 — SC-002: Drift Corpus Execution (15 Scenarios)

**Purpose**: Run the full 15-scenario drift corpus from spec.md and assert ≥95% fire rate on "should fire" scenarios.

**Test file**: `apps/desktop-companion/test/acceptance/driftCorpus.test.ts`

**Setup**: Use `createDriftDetector()` with `DEFAULT_DRIFT_THRESHOLDS`. Each scenario calls `driftDetector.observe(...)` with a fresh `taskBranchId` and fresh state.

**"Should fire" scenarios (10)** — all must return a `DriftSignal` (not `null`):

| # | File paths | Elapsed | Expected confidence |
|---|---|---|---|
| 1 | 3 distinct top-level dirs, 1 topic domain | 0 min | low |
| 2 | 1 dir, 2 distinct topic domains | 0 min | low |
| 3 | 1 dir, 1 domain | 30 min | low |
| 4 | 3 dirs, 2 domains | 0 min | high |
| 5 | 3 dirs, 1 domain | 30 min | high |
| 6 | 1 dir, 2 domains | 30 min | high |
| 7 | 4 dirs, 3 domains | 45 min | high |
| 8 | 3 dirs exactly (at threshold) | 0 min | low |
| 9 | 2 domains exactly (at threshold) | 0 min | low |
| 10 | 0 dirs, 0 non-other domains | 30 min exactly | low |

**"Should not fire" scenarios (5)** — all must return `null`:

| # | File paths | Elapsed | Expected |
|---|---|---|---|
| 1 | 2 dirs, 1 domain | 25 min | null |
| 2 | Same as #4 but fingerprint dismissed before observe | — | null |
| 3 | 3 dirs, 2 domains — after clearSession, re-observe | — | fires (state cleared) |
| 4 | 0 paths | 0 min | null |
| 5 | 2 dirs, 0 non-"other" domains | 0 min | null |

**Assertion**:
```typescript
const firedCount = shouldFireResults.filter(r => r !== null).length;
const fireRate = firedCount / shouldFireScenarios.length;
expect(fireRate).toBeGreaterThanOrEqual(0.95); // ≥95% as per SC-002
```

All 5 "should not fire" scenarios must return exactly `null`.

**Files**: `apps/desktop-companion/test/acceptance/driftCorpus.test.ts`

**Validation**:
- [ ] ≥95% fire rate on "should fire" scenarios (ideally 100%)
- [ ] All 5 "should not fire" scenarios return `null`
- [ ] Dismissed scenario correctly suppressed
- [ ] `clearSession` scenario fires again after reset

---

### T044 — SC-003 Cleanup Timing + SC-004 Resume Timing

**Purpose**: Assert cleanup and resumption complete within their specified time budgets.

**Test file**: `apps/desktop-companion/test/acceptance/timingBudgets.test.ts`

**SC-003 — Cleanup timing (60-second budget)**:
```
Given: 10 stale TaskBranches with real worktrees in tmpdir
When: batch delete all 10 (sequential, no force)
Then: total wall-clock time < 60_000 ms
```
- Use `performance.now()` to measure
- 10 branches is a realistic upper bound for a pilot user
- Each worktree contains a README.md (minimal content) to keep disk ops fast

**SC-004 — Resume timing (3-second budget)**:
```
Given: an active TaskBranch with a real worktree
When: sessionManager.resume(taskBranchId)
Then: resume completes in < 3_000 ms
```
- Measure from `resume()` call to resolved Promise
- This covers `isWorktreeHealthy` + `updateStatus` + polling restart

**Implementation notes**:
- Use real git + real SQLite (via `createTestWiring`)
- These are soft assertions — log a warning if exceeded but do not fail CI immediately
- Add `test.setTimeout(120_000)` for the batch cleanup test

```typescript
test('SC-003: batch cleanup completes in < 60s', { timeout: 120_000 }, async () => {
  // ... setup 10 branches ...
  const start = performance.now();
  // ... batch delete ...
  const elapsed = performance.now() - start;
  if (elapsed > 60_000) {
    console.warn(`SC-003 timing budget exceeded: ${elapsed.toFixed(0)}ms > 60000ms`);
  }
  expect(elapsed).toBeLessThan(60_000);
});
```

**Files**: `apps/desktop-companion/test/acceptance/timingBudgets.test.ts`

**Validation**:
- [ ] SC-003: 10-branch cleanup < 60s
- [ ] SC-004: single resume < 3s
- [ ] Tests use real git and real SQLite

---

### T045 — SC-005: Advisory Mode Exhaustive Acceptance

**Purpose**: Exhaustive acceptance test asserting zero automatic git operations in advisory mode, across every code path in the session lifecycle.

**Test file**: `apps/desktop-companion/test/acceptance/advisoryModeAcceptance.test.ts`

**Steps**:

1. Initialize wiring in advisory mode from the start (`setMode('advisory')` before any events).

2. Fire events across **all code paths** that could trigger auto-ops:
   - `handleIpcEvent` (10 events, varied paths)
   - `detector.startPolling` — ensure it does NOT auto-create a TaskBranch when polling fires modified files
   - `sessionManager.initialize()` — ensure it doesn't create TaskBranches from scratch

3. After all events, assert exhaustively:
   - `store.listAll()` → `[]`
   - Worktree directory `${repoPath}/.joyus-worktrees/` does not exist
   - `notifications` → `[]` (no drift signals, no state events)
   - `detector.pollTimers` size = 0 (no polling started by session creation path)

4. Verify the advisory IPC methods still work (reading is safe):
   - `sessionManager.getMode()` → `'advisory'`
   - `store.listAll()` → `[]` (not a crash)

5. Verify explicit operations still work in advisory mode (user-initiated):
   - `sessionManager.setMode('managed')` → succeeds
   - After switching back, `handleIpcEvent` for a NEW session → TaskBranch IS created

**Files**: `apps/desktop-companion/test/acceptance/advisoryModeAcceptance.test.ts`

**Validation**:
- [ ] 0 auto-created TaskBranches across all advisory code paths
- [ ] 0 worktree directories created
- [ ] 0 notifications emitted
- [ ] `getMode()` returns `'advisory'`
- [ ] Explicit mode switch back to managed → new sessions are managed again

---

### T046 — SC-006 GitHub Desktop + SC-007 Broken Worktree Scan

**Purpose**: Verify GitHub Desktop URL construction and that the startup integrity scan marks broken worktrees.

**Test file**: `apps/desktop-companion/test/acceptance/githubDesktopAndIntegrity.test.ts`

**SC-006 — GitHub Desktop URL check**:
```typescript
// Unit-level acceptance: verify the URL constructed in Sessions.tsx handlers
// matches the expected x-github-client schema

test('SC-006: GitHub Desktop URL uses x-github-client scheme', () => {
  const repoPath = '/Users/test/my-project';
  const expectedUrl = `x-github-client://openRepo/${encodeURIComponent(repoPath)}`;
  // Import and call the openInGitHubDesktop URL builder
  // (extract the URL construction to a pure helper function for testability)
  expect(buildGitHubDesktopUrl(repoPath)).toBe(expectedUrl);
});

test('SC-006: GitHub Desktop URL encodes special characters in path', () => {
  const repoPath = '/Users/test/my project (2026)';
  const url = buildGitHubDesktopUrl(repoPath);
  expect(url).toContain('x-github-client://openRepo/');
  expect(url).not.toContain(' '); // spaces must be encoded
});
```

Note: Extract `buildGitHubDesktopUrl(repoPath: string): string` as a pure function in `Sessions.tsx` or a utils file so it can be tested without mocking Tauri shell.

**SC-007 — Broken worktree scan acceptance**:
```
Given: 3 active TaskBranches: A (worktree exists), B (worktree deleted), C (worktree exists)
When: sessionManager.initialize()
Then:
  - A.status === 'active'
  - B.status === 'broken'
  - C.status === 'active'
  - A second initialize() call is a no-op for A and C (already active), still no-op for B (already broken)
```

**Files**: `apps/desktop-companion/test/acceptance/githubDesktopAndIntegrity.test.ts`

**Validation**:
- [ ] `buildGitHubDesktopUrl` produces correct URL scheme
- [ ] Special characters in path are encoded
- [ ] Integrity scan: missing worktree → `broken`; present → unchanged
- [ ] Integrity scan idempotent on second call

---

### T047 — SC-008: Batch Cleanup with Injected Mid-Batch Failure

**Purpose**: Verify that batch cleanup handles partial failures gracefully — some branches removed, some not — without crashing or leaving state inconsistent.

**Test file**: `apps/desktop-companion/test/acceptance/batchCleanupFailure.test.ts`

**Steps**:

1. Create 4 stale TaskBranches: A, B, C, D.

2. For branch C: corrupt its worktree by removing the `.git` file inside the worktree directory (making `git worktree remove --force` still succeed, but making the worktree "invalid").

3. For branch D: remove the worktree's parent directory entirely before the batch (simulates external deletion mid-batch).

4. Run batch delete for all 4 in order: A, B, C, D.

5. Assert:
   - A: soft-deleted in store ✓
   - B: soft-deleted in store ✓
   - C: soft-deleted in store ✓ (force remove succeeds even with corrupted worktree)
   - D: soft-deleted in store ✓ (idempotent remove handles already-gone path)

6. Assert `store.listAll()` returns `[]` (all gone).

7. Assert no exception propagated to the caller (each delete is independent).

8. **Injected failure variant**: Mock `execGit` to throw on the C worktree removal specifically:
   - A, B, D succeed
   - C fails with "Permission denied"
   - Assert A, B, D are soft-deleted; C has `status === 'stale'` still (not deleted)
   - The batch result includes C's failure with a readable message

**Files**: `apps/desktop-companion/test/acceptance/batchCleanupFailure.test.ts`

**Validation**:
- [ ] All 4 branches handled without crash
- [ ] Injected failure: 3 succeed, 1 fails with structured error
- [ ] Failed branch not soft-deleted (still in store as stale)
- [ ] `store.listAll()` reflects correct final state

---

### T048 — Operational Runbook

**Purpose**: Document the operational procedures for monitoring, diagnosing, and recovering from common incidents related to feature 006.

**File**: `docs/operations/runbook-006.md`

**Sections to include**:

#### 1. Pre-Pilot Checklist

Before shipping 006 to the first non-technical pilot user:
- [ ] `pnpm ci` passes (typecheck + coverage at 100%)
- [ ] All acceptance tests pass (`pnpm vitest run apps/desktop-companion/test/acceptance/`)
- [ ] Git terminology blocklist sweep clean (T042)
- [ ] Drift corpus ≥95% fire rate confirmed (T043)
- [ ] Verify `git` binary is on PATH in the production sidecar environment
- [ ] Verify `~/.joyus/` directory creation works on a fresh machine (no prior Joyus install)
- [ ] Manual smoke test: create a real session, modify 2 files, verify TaskBranch created in sessions panel
- [ ] Manual smoke test: advisory mode — confirm no auto-ops for a developer user

#### 2. Alert: `sidecar.session.worktreeCreateFailed`

**Trigger**: `state.error` notification with `source: 'session.worktree'`

**Likely causes**:
- `git` binary not on PATH in sidecar's environment
- Insufficient disk space for new worktree
- Repository is locked (another git process holding `.git/index.lock`)

**Resolution steps**:
1. Check sidecar logs: `~/.joyus/logs/sidecar.log` (if log rotation is enabled)
2. Verify `git --version` works from the sidecar's shell environment
3. Check disk space: `df -h ~`
4. Check for lock file: `ls -la {repoPath}/.git/*.lock` — if present, remove only if no git process is running
5. The affected TaskBranch will have `status: 'broken'` in the sessions panel. The user can remove it and the next file modification will create a fresh one.

#### 3. Alert: `sidecar.session.dbOpenFailed`

**Trigger**: Sidecar startup fails with SQLite error

**Likely causes**:
- `~/.joyus/session-manager.db` is corrupted (e.g., disk full during write)
- File permissions changed on `~/.joyus/`

**Resolution steps**:
1. Back up the database: `cp ~/.joyus/session-manager.db ~/.joyus/session-manager.db.bak`
2. Delete the corrupt database: `rm ~/.joyus/session-manager.db`
3. Restart the desktop companion — it will create a fresh database
4. Note: existing TaskBranch records are lost, but the git worktrees themselves remain on disk under `{repoPath}/.joyus-worktrees/`. Users can clean these up manually or via `git worktree remove`.

#### 4. Incident: Worktrees Accumulating Unexpectedly

**Symptom**: User reports many sessions showing "Inactive" status; disk usage growing

**Likely cause**: Stale threshold not running (sidecar crashed on startup before `initialize()` completed)

**Resolution**:
1. In the sessions panel, click "Clean up inactive tasks" to batch-delete stale branches
2. For manual cleanup: `git worktree list` in the affected repo; `git worktree remove --force {path}` for orphaned entries
3. Check that sidecar starts cleanly: look for errors in sidecar stderr (Tauri dev tools console)

#### 5. Incident: Drift Signals Not Appearing

**Symptom**: User reports working across many files with no drift suggestions

**Likely cause**:
- `state.driftSignal` event not reaching the WebView (Tauri event routing issue)
- All drift signals were dismissed and fingerprints match

**Resolution**:
1. Check sidecar `sendNotification('state.driftSignal', ...)` is firing: add a temporary log line in `sessionWiring.ts`
2. Check the Tauri event bridge: open Tauri dev tools, look for `state.driftSignal` in the event log
3. If signals are firing but UI doesn't show them: reload the WebView (force refresh in Tauri dev mode)
4. Drift dismissals persist only in memory (not SQLite). A sidecar restart clears all dismissed fingerprints.

**Files**: `docs/operations/runbook-006.md`

**Validation**:
- [ ] Runbook file created at correct path
- [ ] Pre-pilot checklist complete (8+ items)
- [ ] Both alerts documented with resolution steps
- [ ] Both incidents documented with resolution steps

## Definition of Done

- [x] 6 acceptance test files created in `apps/desktop-companion/test/acceptance/`
- [x] All 8 SCs (SC-001 through SC-008) covered
- [x] Git terminology blocklist sweep passes
- [x] Drift corpus ≥95% fire rate
- [x] Timing budgets tested (SC-003 < 60s, SC-004 < 3s)
- [x] Batch cleanup partial failure handled gracefully
- [x] `docs/operations/runbook-006.md` created with pre-pilot checklist, 2 alerts, 2 incidents
- [x] `pnpm typecheck` passes

## Risks

- **Timing tests in CI**: Wall-clock timing tests are inherently flaky in shared CI environments. If SC-003/SC-004 timing tests flake, gate them with `process.env.CI` and only enforce in local runs, or increase the budget to 2× for CI.
- **`buildGitHubDesktopUrl` extraction**: T046 requires this to be a pure, exported helper function. If the Sessions.tsx author inlines the URL construction, it can't be tested without mocking Tauri. Ensure WP05 implementation exports this helper.
- **Runbook maintenance**: The runbook becomes stale as the feature evolves. Add a note to the runbook header: "Last verified: 2026-03-19. Review when session-manager or sessionWiring.ts changes."

## Activity Log

- 2026-03-19T00:00:00Z – spec-kitty – lane=planned – Work package created
