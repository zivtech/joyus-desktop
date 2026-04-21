---
work_package_id: WP02
title: 'session-manager: File Modification Detection'
dependencies: []
base_branch: 006-managed-git-sessions-WP01
base_commit: d062bb6fbf0bf2427c64defa0942a67f03ee0782
created_at: '2026-03-20T01:34:57.735165+00:00'
subtasks: [T009, T010, T011, T012, T013, T014]
history:
- date: '2026-03-19'
  event: created
authoritative_surface: ''
execution_mode: code_change
mission_id: 01KPR4E967F61H0B7K24440QG4
owned_files:
- kitty-specs/006-managed-git-sessions/contracts/session-manager.ts
- src/fileModificationDetector.ts
- src/index.ts
- src/sessionManager.ts
- src/sidecar/services.ts
- test/fileModificationDetector.test.ts
- test/sessionManager.test.ts
wp_code: WP02
---

# WP02 — session-manager: File Modification Detection

**Feature**: 006 — Managed Git Sessions
**Priority**: P0 (blocks WP04)
**Implement with**: `spec-kitty implement WP02 --base WP01`

## Objective

Add file modification detection to `packages/session-manager`. This is the triggering mechanism for the entire feature: when a session first modifies a file in a git repo, the `SessionManager` creates a `TaskBranch`. The detection uses two sources — a Claude Code `PostToolUse:Write` IPC hook (primary) and a `git status --porcelain` poll (fallback) — with deduplication between them.

## Context

**Package**: `packages/session-manager` (created in WP01)
**New files**: `fileModificationDetector.ts`, `sessionManager.ts`
**Contract**: `kitty-specs/006-managed-git-sessions/contracts/session-manager.ts` — `FileModificationDetector`, `SessionManager`, `OpenSessionManager`

**IPC integration**: The sidecar registers `session.fileModified` in `apps/desktop-companion/src/sidecar/services.ts` (done in WP04). WP02 implements the handler that `services.ts` will call.

**Poll mechanism**: `git status --porcelain <cwd>` returns non-empty output when tracked files are modified. Run this against the repo root on a configurable interval (default 10s).

**Deduplication**: The detector maintains a per-session `lastIpcFiredAt` timestamp. If an IPC event fired within the last poll window, the poll result for that session is suppressed.

## Subtasks

### T009 — `FileModificationDetector.handleIpcEvent()`

**Purpose**: Handle an incoming `session.fileModified` IPC notification from Claude Code.

**Steps**:

1. Create `packages/session-manager/src/fileModificationDetector.ts`.

2. `FileModificationDetector` maintains:
   - `listeners: Array<(event: FileModificationEvent) => void>`
   - `lastIpcFiredAt: Map<sessionId, number>` — Unix ms of last IPC event per session

3. Implement `handleIpcEvent(raw)`:
```typescript
handleIpcEvent(raw: Omit<FileModificationEvent, 'detectedAt' | 'source'>): void {
  const event: FileModificationEvent = {
    ...raw,
    detectedAt: Date.now(),
    source: 'hook',
  };
  this.lastIpcFiredAt.set(raw.sessionId, event.detectedAt);
  this.emit(event);
}
```

4. Implement `onModification(handler)` to register listeners.

5. Private `emit(event)` calls all registered listeners.

**Files**: `packages/session-manager/src/fileModificationDetector.ts`

**Validation**:
- [ ] `handleIpcEvent` sets `source: 'hook'` and `detectedAt`
- [ ] Registered listeners called on `handleIpcEvent`
- [ ] `lastIpcFiredAt` updated on each IPC event

---

### T010 — Polling Service (`startPolling` / `stopPolling`)

**Purpose**: Implement the `git status --porcelain` polling fallback for non-hook file modifications.

**Steps**:

1. Add to `FileModificationDetector`:
   - `pollTimers: Map<sessionId, ReturnType<typeof setInterval>>`

2. Implement `startPolling(repoPath, sessionId)`:
   - Set interval at `pollIntervalMs` (default 10000)
   - On each tick:
     1. Run `execGit(['status', '--porcelain'], repoPath)`
     2. If stdout is non-empty AND deduplication check passes (T011): emit a `FileModificationEvent` with `source: 'poll'`
   - Store timer in `pollTimers`

3. Implement `stopPolling(sessionId)`:
   - `clearInterval(this.pollTimers.get(sessionId))`
   - Delete from `pollTimers`

4. Inject `execGit` and `pollIntervalMs` via constructor.

**Files**: `packages/session-manager/src/fileModificationDetector.ts`

**Validation**:
- [ ] `startPolling` fires on interval; `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync` controls timing
- [ ] Non-empty `git status` output → event emitted
- [ ] Empty `git status` output → no event
- [ ] `stopPolling` clears interval and removes timer

---

### T011 — Deduplication

**Purpose**: Suppress the poll event when an IPC hook already fired for the same session within the current poll window.

**Steps**:

1. Add deduplication check in the polling tick (T010 step 2.2):
```typescript
private isDuplicateOfIpc(sessionId: string, nowMs: number): boolean {
  const lastIpc = this.lastIpcFiredAt.get(sessionId);
  if (lastIpc === undefined) return false;
  return (nowMs - lastIpc) < this.pollIntervalMs;
}
```

2. Suppress emit if `isDuplicateOfIpc` returns `true`.

3. Export `isDuplicateOfIpc` as a testable method (or test via behavior).

**Files**: `packages/session-manager/src/fileModificationDetector.ts`

**Validation**:
- [ ] IPC fires at T=0; poll fires at T=8000 → poll suppressed (within 10s window)
- [ ] IPC fires at T=0; poll fires at T=12000 → poll NOT suppressed (outside window)
- [ ] No IPC in session → poll always fires

---

### T012 — `SessionManager.onFileModification()` — Managed Mode TaskBranch Creation

**Purpose**: The core managed-mode behavior: create a `TaskBranch` on the first file modification in a git repo.

**Steps**:

1. Create `packages/session-manager/src/sessionManager.ts`.

2. `SessionManager` constructor takes: `TaskBranchStore`, `WorktreeManager`, `FileModificationDetector`, `modeStore` (global/per-repo mode config).

3. Register `detector.onModification(this.onFileModification.bind(this))` in constructor.

4. Implement `onFileModification(event: FileModificationEvent)`:
   - Check `getMode(event.repoPath)` — if `"advisory"`, return immediately (no action)
   - Check `store.findBySessionId(event.sessionId)` — if exists, update activity and return
   - Infer mission label: `inferMissionLabel([event.filePath])`
   - Create worktree: `worktreeManager.create({ repoPath, missionSlug, sessionDate })`
   - Create store record: `store.create({ sessionId, repoPath, worktreePath, branchName, missionLabel, missionSource: 'inferred', mode: 'managed' })`
   - Start polling: `detector.startPolling(event.repoPath, event.sessionId)`

5. Errors during worktree creation must be caught and stored as a `"broken"` record (not thrown to the caller).

**Files**: `packages/session-manager/src/sessionManager.ts`

**Validation**:
- [ ] Advisory mode → no worktree created, no store record
- [ ] Managed mode, first event → TaskBranch created
- [ ] Managed mode, second event → `updateActivity` only (no duplicate worktree)
- [ ] Worktree creation failure → `"broken"` record created, no throw

---

### T013 — `SessionManager` Remaining API

**Purpose**: Implement resume, delete, uncommitted-change detection, mode management, and initialize.

**Steps**:

1. `resume(taskBranchId)`:
   - Fetch record; throw `SessionNotFoundError` if missing
   - Call `isWorktreeHealthy`; if not healthy: `updateStatus('broken')`, throw `SessionBrokenError`
   - Call `updateStatus('active')`
   - Stop and restart polling for the session (refreshes activity tracking)
   - Return updated `TaskBranch`

2. `delete(taskBranchId, { force })`:
   - If `!force`: call `hasUncommittedChanges` — if true, throw `UncommittedChangesError`
   - Call `worktreeManager.remove(worktreePath)`
   - Call `store.softDelete(taskBranchId)`
   - Call `detector.stopPolling(sessionId)`

3. `hasUncommittedChanges(taskBranchId)`:
   - Run `execGit(['status', '--porcelain'], worktreePath)`
   - Return `stdout.trim().length > 0`

4. `getMode(repoPath?)` / `setMode(mode, repoPath?)`:
   - Simple in-memory map: `repoModes: Map<string, OperatingMode>` + `globalMode: OperatingMode`
   - `getMode(repoPath)` returns repo-specific mode if set, else global mode
   - `setMode` updates accordingly; affects new sessions only (existing TaskBranches retain their creation-time mode stored in SQLite)

5. `initialize()`:
   - Call `store.scanIntegrity(execGit)`
   - Call `store.applyStaleThreshold(staleBefore)`
   - Call `store.detectMerged(execGit)`

**Files**: `packages/session-manager/src/sessionManager.ts`

**Validation**:
- [ ] `resume` of broken TaskBranch → `SessionBrokenError`
- [ ] `delete` with uncommitted changes and `force: false` → throws
- [ ] `delete` with `force: true` skips uncommitted check
- [ ] `initialize` calls all three store maintenance methods
- [ ] `setMode` at repo level overrides global

---

### T014 — Unit Tests

**Purpose**: 100% coverage for `fileModificationDetector.ts` and `sessionManager.ts`.

**Test files**: `packages/session-manager/test/fileModificationDetector.test.ts`, `packages/session-manager/test/sessionManager.test.ts`

**Key test cases**:

```
fileModificationDetector:
  - handleIpcEvent: listener called with source='hook'
  - handleIpcEvent: updates lastIpcFiredAt
  - polling: non-empty git status → event emitted (vi.advanceTimersByTimeAsync)
  - polling: empty git status → no event
  - dedup: IPC within window → poll suppressed
  - dedup: IPC outside window → poll fires
  - stopPolling: interval cleared

sessionManager:
  - advisory mode: onFileModification → no store record created
  - managed mode: first event → TaskBranch created, polling started
  - managed mode: second event for same session → updateActivity only
  - managed mode: worktree creation throws → broken record created
  - resume: missing → throws; broken worktree → status updated + throws
  - delete: uncommitted + force:false → throws; force:true → proceeds
  - hasUncommittedChanges: non-empty stdout → true
  - initialize: calls scanIntegrity + applyStaleThreshold + detectMerged
```

**Tooling**: `vi.useFakeTimers()` for polling tests; `vi.fn()` for `store`, `worktreeManager`, `execGit`.

**Validation**:
- [ ] `pnpm coverage` at 100% for WP02 source files
- [ ] `pnpm typecheck` passes

## Definition of Done

- [ ] `fileModificationDetector.ts` and `sessionManager.ts` created
- [ ] All error types exported: `SessionNotFoundError`, `SessionBrokenError`, `UncommittedChangesError`
- [ ] Public API added to `src/index.ts`: `createSessionManager`, `FileModificationDetector`, error types
- [ ] `pnpm coverage` at 100%
- [ ] `pnpm typecheck` passes

## Risks

- **`vi.useFakeTimers()` + async**: The polling tick is async (`await execGit()`). Use `vi.advanceTimersByTimeAsync()` (not `vi.advanceTimersByTime()`) to correctly advance through async timer callbacks.
- **Advisory mode strict enforcement**: `onFileModification` must return immediately at the mode check — no store lookup, no worktree check. Any code path beyond that point in advisory mode is a bug.
- **`exactOptionalPropertyTypes`**: `startPolling` may store `undefined` if `pollTimers.get` is called before `startPolling`. Use `Map.has()` guards before `get()`.

## Activity Log

- 2026-03-19T00:00:00Z – spec-kitty – lane=planned – Work package created
