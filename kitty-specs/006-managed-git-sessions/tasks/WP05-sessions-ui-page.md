---
work_package_id: WP05
title: Sessions UI Page
dependencies: []
subtasks: [T028, T029, T030, T031, T032, T033, T034, T035]
history:
- date: '2026-03-19'
  event: created
authoritative_surface: ''
execution_mode: code_change
mission_id: 01KPR4E967F61H0B7K24440QG4
owned_files:
- src/main.rs
- src/ui/App.tsx
- src/ui/components/DriftBanner.tsx
- src/ui/components/Layout.tsx
- src/ui/components/TaskBranchCard.tsx
- src/ui/hooks/useGovernance.ts
- src/ui/hooks/useTauriEvent.ts
- src/ui/pages/Dashboard.tsx
- src/ui/pages/Sessions.tsx
- test/ui/Sessions.test.tsx
wp_code: WP05
---

# WP05 — Sessions UI Page

**Feature**: 006 — Managed Git Sessions
**Priority**: P1 (blocks WP06)
**Implement with**: `spec-kitty implement WP05 --base WP04`

## Objective

Add a `/sessions` route to the React frontend that shows all task branches, allows resumption and deletion, displays drift banners, exposes the mode toggle, and provides GitHub Desktop launch. After this WP, the full user-facing pipeline is functional.

## Context

**Existing files to read first**:
- `apps/desktop-companion/src/ui/App.tsx` — add `<Route path="/sessions" element={<Sessions />} />`
- `apps/desktop-companion/src/ui/components/Layout.tsx` — add Sessions nav item
- `apps/desktop-companion/src/ui/pages/Dashboard.tsx` — follow the `safeInvoke` + inline styles pattern
- `apps/desktop-companion/src/ui/hooks/useGovernance.ts` — follow event subscription pattern
- `apps/desktop-companion/src/ui/hooks/useTauriEvent.ts` — `useTauriEvent<T>(eventName)` returns latest event payload

**IPC pattern**: The UI calls the sidecar via Tauri commands, same as `get_usage_summary`, `get_governance_mode`, etc. For sessions, the Rust layer exposes Tauri commands that proxy to the sidecar's `session.*` methods. In the UI, use:
```typescript
async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  } catch {
    return undefined;
  }
}
```
The Tauri command names for sessions are: `session_list`, `session_resume`, `session_delete`, `session_has_uncommitted_changes`, `session_get_mode`, `session_set_mode`.

**Git terminology blocklist**: No user-facing string may contain: branch, commit, hash, HEAD, checkout, merge, stash, worktree, ref, diff, push, pull. Use: task, session, workspace, changes, save, etc.

**Drift event**: The sidecar emits `state.driftSignal` notifications which Tauri relays as events. In the UI, `listen('state.driftSignal', handler)` — accumulate signals in state, not just the latest.

**GitHub Desktop URL scheme**: `x-github-client://openRepo/{repoPath}` — open with `open` (macOS) or `start` (Windows) via Tauri's shell opener.

**Tests**: `apps/desktop-companion/test/ui/Sessions.test.tsx` — Vitest + React Testing Library. Mock `@tauri-apps/api/core` and `@tauri-apps/api/event` with `vi.mock`.

## Subtasks

### T028 — `TaskBranchCard.tsx`

**Purpose**: Card component showing one task branch — mission label, status badge, relative time, and contextual action buttons.

**Steps**:

1. Create `apps/desktop-companion/src/ui/components/TaskBranchCard.tsx`.

2. Props interface:
```typescript
interface TaskBranchCardProps {
  branch: TaskBranch;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenGitHub: (repoPath: string, branchName: string) => void;
}
```

3. Status badge colors:
   - `active` → green (`#22c55e`)
   - `stale` → amber (`#f59e0b`)
   - `broken` → red (`#ef4444`)
   - `merged` → gray (`#6b7280`)

4. Status labels (NO git terminology):
   - `active` → "Active"
   - `stale` → "Inactive"
   - `broken` → "Unavailable"
   - `merged` → "Completed"

5. Relative time: format `lastActivityAt` as "X minutes ago", "X hours ago", "X days ago".

6. Buttons:
   - `active` / `stale` → "Resume" button (calls `onResume`)
   - All non-deleted → "Remove" button (calls `onDelete`) — NOT "delete"
   - All → "Open in GitHub Desktop" link (calls `onOpenGitHub`)
   - `broken` → show inline warning: "This workspace is unavailable. Removing it will clean up the local files."

7. Follow the inline-style pattern from `Dashboard.tsx` (no CSS classes, no Tailwind).

**Files**: `apps/desktop-companion/src/ui/components/TaskBranchCard.tsx`

**Validation**:
- [ ] Status badge renders correct color per status
- [ ] No git terminology in rendered text
- [ ] `onResume` called with correct id
- [ ] `onDelete` called with correct id
- [ ] `broken` shows warning message

---

### T029 — `DriftBanner.tsx`

**Purpose**: Low-confidence toast notification and high-confidence inline modal for drift signals.

**Steps**:

1. Create `apps/desktop-companion/src/ui/components/DriftBanner.tsx`.

2. Props:
```typescript
interface DriftBannerProps {
  signal: DriftSignalPayload;
  onDismiss: (taskBranchId: string) => void;
  onNewSession: (taskBranchId: string) => void;
}

interface DriftSignalPayload {
  taskBranchId: string;
  confidence: 'low' | 'high';
  heuristics: { directoryCount: number; topicDomainCount: number; elapsedMinutes: number };
  explanation: string;
}
```

3. **Low confidence** (`confidence === 'low'`): render a subtle amber banner:
   - Text: "Your work may be spreading across multiple areas. Consider starting a fresh task."
   - Dismiss button (×)
   - No blocking behavior

4. **High confidence** (`confidence === 'high'`): render an inline card with more prominence:
   - Title: "This task is covering a lot of ground"
   - Body: use `signal.explanation` (plain language from the heuristics)
   - "Start Fresh Task" button → calls `onNewSession`
   - "Keep Going" button → calls `onDismiss`
   - No modal overlay — inline only

5. No git terminology. The `explanation` string will be generated by the wiring layer and will not contain git terms.

**Files**: `apps/desktop-companion/src/ui/components/DriftBanner.tsx`

**Validation**:
- [ ] Low confidence → banner with dismiss
- [ ] High confidence → card with two actions
- [ ] `onDismiss` called on dismiss
- [ ] `onNewSession` called on "Start Fresh Task"

---

### T030 — `Sessions.tsx` Page Shell

**Purpose**: Page shell that fetches task branches on mount, manages state, and renders the list.

**Steps**:

1. Create `apps/desktop-companion/src/ui/pages/Sessions.tsx`.

2. State:
   - `branches: TaskBranch[]`
   - `loading: boolean`
   - `error: string | undefined`
   - `driftSignals: DriftSignalPayload[]`

3. On mount: call `safeInvoke<TaskBranch[]>('session_list')` and set branches. Set `loading = false` after response.

4. Render:
   - Page heading: "My Tasks" (not "Sessions" — avoid technical jargon for non-dev users)
   - Mode toggle (T033) in the page header area
   - Loading state: "Loading your tasks…"
   - Empty state: "No active tasks. Start a task to see it here."
   - Drift banners above the list (T034)
   - List of `TaskBranchCard` components (T028)
   - "Clean up inactive tasks" button (T032)

5. Add route and nav:
   - In `App.tsx`: `<Route path="/sessions" element={<Sessions />} />`
   - In `Layout.tsx` `NAV_ITEMS`: `{ to: "/sessions", label: "Tasks", icon: "◫" }`

**Files**: `apps/desktop-companion/src/ui/pages/Sessions.tsx`, `apps/desktop-companion/src/ui/App.tsx`, `apps/desktop-companion/src/ui/components/Layout.tsx`

**Validation**:
- [ ] `session_list` called on mount
- [ ] Loading state shown while fetching
- [ ] Empty state shown when no branches
- [ ] "Tasks" nav item appears in sidebar
- [ ] Route `/sessions` renders the page

---

### T031 — Delete Confirmation Flow

**Purpose**: Inline confirmation for clean branches, modal warning for branches with uncommitted changes.

**Steps**:

1. Add `pendingDelete: string | undefined` state to `Sessions.tsx` — the `taskBranchId` awaiting confirmation.

2. `onDelete(id)` handler:
   - Call `safeInvoke<{ hasUncommittedChanges: boolean }>('session_has_uncommitted_changes', { taskBranchId: id })`
   - If `hasUncommittedChanges === false`: set `pendingDelete = id` (shows inline confirm)
   - If `hasUncommittedChanges === true`: set `pendingDelete = id` AND set `pendingDeleteHasChanges = true` (shows warning modal)

3. Inline confirm (clean branch): replace card actions with "Really remove this task?" + "Yes, remove" / "Cancel" buttons — no modal overlay.

4. Warning modal (uncommitted changes): show modal overlay with:
   - Title: "This task has unsaved changes"
   - Body: "Removing this task will discard changes that haven't been saved. This cannot be undone."
   - "Remove Anyway" → calls `confirmDelete(id, force: true)`
   - "Keep It" → dismisses

5. `confirmDelete(id, force)`:
   - Call `safeInvoke('session_delete', { taskBranchId: id, force })`
   - On success: remove from `branches` state
   - On error response with `error: 'uncommitted_changes'`: show warning modal (safety net)

**Files**: `apps/desktop-companion/src/ui/pages/Sessions.tsx`

**Validation**:
- [ ] Clean branch → inline confirm (no modal)
- [ ] Changed branch → modal warning
- [ ] "Remove Anyway" calls with `force: true`
- [ ] "Keep It" dismisses without deleting
- [ ] Branch removed from list after successful delete

---

### T032 — Batch Cleanup

**Purpose**: "Clean up inactive tasks" button that removes all stale branches, showing partial-failure results.

**Steps**:

1. Add `batchResult: BatchCleanupResult | undefined` state.

```typescript
interface BatchCleanupResult {
  removed: number;
  failed: Array<{ missionLabel: string; reason: string }>;
}
```

2. `handleBatchCleanup()`:
   - Filter `branches` where `status === 'stale'`
   - For each: call `safeInvoke('session_delete', { taskBranchId: id, force: false })`
   - Track successes and failures (catch errors per-item)
   - Set `batchResult` with counts

3. Show "Clean up inactive tasks" button only when `branches.some(b => b.status === 'stale')`.

4. After cleanup, show result inline:
   - Success: "Removed X inactive tasks."
   - Partial failure: "Removed X tasks. Y could not be removed: [list]."
   - Use plain-language labels (no ids) — show `missionLabel` in failure list.

5. Refresh `branches` after batch by calling `session_list` again.

**Files**: `apps/desktop-companion/src/ui/pages/Sessions.tsx`

**Validation**:
- [ ] Button hidden when no stale branches
- [ ] Each stale branch deleted independently (partial failure allowed)
- [ ] Result shown with count and failure details
- [ ] List refreshed after batch

---

### T033 — Mode Toggle

**Purpose**: Expose the managed/advisory mode toggle in the page header.

**Steps**:

1. On mount: call `safeInvoke<{ mode: 'managed' | 'advisory' }>('session_get_mode')` and set `mode` state.

2. Render a toggle in the `Sessions.tsx` header area:
   - Label: "Automation mode"
   - Option A: "Auto-managed" (managed mode) — full automation
   - Option B: "Advisory" (advisory mode) — for developers, suggestions only
   - Show subtitle under current selection: "Auto-managed: tasks are created automatically" / "Advisory: you'll see suggestions, but nothing happens automatically"

3. On toggle:
   - Call `safeInvoke('session_set_mode', { mode: newMode })`
   - Update local `mode` state on success
   - Show note: "Affects new tasks only. Existing tasks are not changed."

**Files**: `apps/desktop-companion/src/ui/pages/Sessions.tsx`

**Validation**:
- [ ] `session_get_mode` called on mount
- [ ] `session_set_mode` called on toggle
- [ ] "Affects new tasks only" note shown on change
- [ ] No git terminology ("branch", "managed mode" is OK as an internal term but the UI label should say "Auto-managed")

---

### T034 — Subscribe to `state.driftSignal` Tauri Events

**Purpose**: Receive drift signals from the sidecar and render `DriftBanner` components.

**Steps**:

1. In `Sessions.tsx`, subscribe to `state.driftSignal` using the `safeListen` pattern (not `useTauriEvent` — we need to accumulate signals, not just keep the latest):

```typescript
useEffect(() => {
  let unlisten: (() => void) | undefined;
  void safeListen<DriftSignalPayload>('state.driftSignal', (e) => {
    setDriftSignals((prev) => {
      // Deduplicate: replace existing signal for same taskBranchId
      const filtered = prev.filter(s => s.taskBranchId !== e.payload.taskBranchId);
      return [...filtered, e.payload];
    });
  }).then((fn) => { unlisten = fn; });
  return () => { unlisten?.(); };
}, []);
```

2. Render a `DriftBanner` for each signal above the task list:
   - `onDismiss(id)`: remove the signal from `driftSignals` state
   - `onNewSession(id)`: remove the signal + call `safeInvoke('session_set_mode', { mode: 'advisory' })` (advisory mode for next session) + navigate to `/` (Dashboard) so the user can start fresh

3. `safeListen` helper (same pattern as `useGovernance.ts`):
```typescript
async function safeListen<T>(
  event: string,
  handler: (e: { payload: T }) => void
): Promise<() => void> {
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return listen<T>(event, handler);
  } catch {
    return () => undefined;
  }
}
```

**Files**: `apps/desktop-companion/src/ui/pages/Sessions.tsx`

**Validation**:
- [ ] `state.driftSignal` listener registered on mount, cleaned up on unmount
- [ ] Multiple signals accumulate (not replaced)
- [ ] Second signal for same `taskBranchId` replaces the first
- [ ] `onDismiss` removes banner from UI without any IPC call

---

### T035 — "Open in GitHub Desktop" Action

**Purpose**: Launch GitHub Desktop scoped to the task's repo/worktree, with a not-installed fallback.

**Steps**:

1. Implement `openInGitHubDesktop(repoPath: string)`:
   - Use Tauri shell opener: `safeInvoke('open_url', { url: \`x-github-client://openRepo/${encodeURIComponent(repoPath)}\` })`
   - This is a best-effort action — if GitHub Desktop is not installed the URL scheme won't resolve

2. In `TaskBranchCard.tsx`, the "Open in GitHub Desktop" button:
   - Calls `onOpenGitHub(branch.repoPath, branch.branchName)`
   - After click: show transient feedback "Opening GitHub Desktop…" for 2 seconds, then reset
   - If the invoke returns an error (GitHub Desktop not installed): show inline fallback text "GitHub Desktop does not appear to be installed. Download it at desktop.github.com"
   - The fallback text is plain — no navigation away from the panel

3. `Sessions.tsx` `onOpenGitHub` handler:
   - Call `openInGitHubDesktop(repoPath)` — pass `repoPath` (the repo root, not the worktree path)

**Files**: `apps/desktop-companion/src/ui/pages/Sessions.tsx`, `apps/desktop-companion/src/ui/components/TaskBranchCard.tsx`

**Validation**:
- [ ] `open_url` called with correct `x-github-client://openRepo/...` scheme
- [ ] Feedback message shown after click
- [ ] Error from invoke → fallback message shown, no crash
- [ ] `repoPath` (not worktree path) passed to URL

---

### Unit Tests (T028–T035)

**Test file**: `apps/desktop-companion/test/ui/Sessions.test.tsx`

**Setup**:
```typescript
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
```

**Key test cases**:
- `session_list` called on mount; loading state shown until resolved
- Empty list → empty state message
- `TaskBranchCard` renders mission label + correct status label (no git terms)
- Resume button → `session_resume` invoke called
- Delete (clean) → inline confirm shown; confirm → `session_delete` called
- Delete (uncommitted) → modal shown; "Remove Anyway" → `session_delete` with `force: true`
- Batch cleanup → stale branches deleted, result shown
- Mode toggle → `session_get_mode` on mount, `session_set_mode` on change
- Drift signal event → `DriftBanner` rendered; dismiss → banner removed

**Validation**:
- [ ] `pnpm coverage` at 100% for `Sessions.tsx`, `TaskBranchCard.tsx`, `DriftBanner.tsx`
- [ ] `pnpm typecheck` passes

## Definition of Done

- [ ] `Sessions.tsx` created at `apps/desktop-companion/src/ui/pages/Sessions.tsx`
- [ ] `TaskBranchCard.tsx` created
- [ ] `DriftBanner.tsx` created
- [ ] Route `/sessions` added to `App.tsx`
- [ ] "Tasks" nav item added to `Layout.tsx`
- [ ] All 7 IPC methods wired: list, resume, delete, hasUncommittedChanges, getMode, setMode
- [ ] Drift signal subscription live
- [ ] GitHub Desktop launch with fallback
- [ ] No git terminology in any user-facing string
- [ ] `pnpm coverage` at 100%
- [ ] `pnpm typecheck` passes

## Risks

- **Tauri command names**: The Rust command names (`session_list`, etc.) must match exactly what's registered in the Tauri Rust layer. Verify against `src-tauri/src/main.rs` (or equivalent) before writing the invoke calls. If the Rust commands aren't yet wired, stub them as returning empty arrays.
- **`x-github-client` URL scheme**: Tested on macOS only; Windows uses a different registry mechanism but the same URL scheme should work. The fallback covers the not-installed case.
- **`useTauriEvent` vs accumulation**: `useTauriEvent` only stores the latest event. For drift signals, use raw `listen` + state array to accumulate multiple active banners.
- **Git terminology in explanation strings**: The `explanation` field on `DriftSignalPayload` is generated by the sidecar's drift detector. The heuristics engine must not include git terms in its explanation output — verify this in WP03's implementation.

## Activity Log

- 2026-03-19T00:00:00Z – spec-kitty – lane=planned – Work package created
