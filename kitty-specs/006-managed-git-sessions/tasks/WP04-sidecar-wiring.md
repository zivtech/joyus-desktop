---
work_package_id: WP04
title: Sidecar Wiring
dependencies: []
subtasks: [T021, T022, T023, T024, T025, T026, T027]
history:
- date: '2026-03-19'
  event: created
authoritative_surface: ''
execution_mode: code_change
mission_id: 01KPR4E967F61H0B7K24440QG4
owned_files:
- src/controlPlaneWiring.ts
- src/sidecar/ipc-handler.ts
- src/sidecar/main.ts
- src/sidecar/services.ts
- src/sidecar/sessionWiring.ts
- test/sessionWiring.test.ts
wp_code: WP04
---

# WP04 — Sidecar Wiring

**Feature**: 006 — Managed Git Sessions
**Priority**: P1 (blocks WP05)
**Implement with**: `spec-kitty implement WP04 --base WP03`

## Objective

Wire `packages/session-manager` and `packages/drift-detector` into the companion sidecar lifecycle. Register all session-related IPC methods, connect the drift detector to Tauri event emission, and add shutdown handlers. After this WP, the full backend pipeline is live — file modification detection → TaskBranch creation → drift evaluation → Tauri event — even without the UI.

## Context

**Existing files to read first**:
- `apps/desktop-companion/src/sidecar/services.ts` — existing IPC method registrations
- `apps/desktop-companion/src/sidecar/ipc-handler.ts` — `registerMethod`, `sendNotification`
- `apps/desktop-companion/src/controlPlaneWiring.ts` — follow this pattern for the wiring factory + shutdown handlers

**New file**: `apps/desktop-companion/src/sidecar/sessionWiring.ts`
**Modified file**: `apps/desktop-companion/src/sidecar/services.ts`

**Tauri event channel**: The sidecar emits events via `sendNotification` (defined in `ipc-handler.ts`). The UI layer (WP05) subscribes with `useTauriEvent`.

**execGit implementation**: The sidecar needs a concrete `ExecGit`. Use Node's `child_process.spawn` or `execFile` to run `git`. Wrap in a promise that resolves `{ stdout, stderr }` or rejects on non-zero exit code.

## Subtasks

### T021 — `sessionWiring.ts` Factory

**Purpose**: Create the `createSessionWiring` factory that constructs and connects all session management components.

**Steps**:

1. Create `apps/desktop-companion/src/sidecar/sessionWiring.ts`.

2. Implement concrete `execGit: ExecGit`:
```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

export async function execGit(args: string[], cwd?: string) {
  const result = await execFileAsync('git', args, { cwd });
  return { stdout: result.stdout, stderr: result.stderr };
}
```

3. Implement `createSessionWiring(deps: SessionWiringDeps)`:
```typescript
interface SessionWiringDeps {
  sendNotification: (method: string, params: unknown) => void;
  dbPath?: string;
  pollIntervalMs?: number;
  staleDays?: number;
}
```

4. Inside `createSessionWiring`:
   - `await openTaskBranchStore(deps.dbPath)`
   - `new FileModificationDetector({ execGit, pollIntervalMs: deps.pollIntervalMs })`
   - `createDriftDetector()` (default thresholds, NoOp confirmer)
   - `createSessionManager({ store, worktreeManager, detector, execGit })`
   - Wire drift: after `sessionManager.onFileModification`, call `driftDetector.observe(...)` and emit result (T025)
   - Call `sessionManager.initialize()` on startup
   - Return `{ sessionManager, detector, driftDetector, shutdown }`

**Files**: `apps/desktop-companion/src/sidecar/sessionWiring.ts`

**Validation**:
- [ ] Factory returns all components
- [ ] `initialize()` called during construction
- [ ] `sendNotification` is injected (not imported directly)

---

### T022 — Register `session.fileModified` IPC Method

**Purpose**: Register the IPC entry point that Claude Code's `PostToolUse:Write` hook calls.

**Steps**:

1. In `apps/desktop-companion/src/sidecar/services.ts`, add:
```typescript
registerMethod('session.fileModified', async (params: unknown) => {
  const { sessionId, repoPath, filePath } = parseFileModifiedParams(params);
  wiring.detector.handleIpcEvent({ sessionId, repoPath, filePath });
  return { ok: true };
});
```

2. Implement `parseFileModifiedParams(params)` — validate shape, throw on missing fields with clear message.

3. Call `createSessionWiring(...)` once at services init and pass `wiring` reference to all session method registrations.

**Files**: `apps/desktop-companion/src/sidecar/services.ts`

**Validation**:
- [ ] Valid payload → `handleIpcEvent` called
- [ ] Missing `sessionId` → error response with clear message
- [ ] Method registered before sidecar accepts connections

---

### T023 — Register `session.list`, `session.resume`, `session.delete`

**Purpose**: Register the IPC methods the UI will use for the sessions panel.

**Steps**:

1. `session.list`:
   - Call `wiring.sessionManager` — but wait: `listAll` is on the store. Expose via `SessionManager` or call store directly through wiring.
   - Return serialized `TaskBranch[]`

2. `session.resume`:
   - Params: `{ taskBranchId: string }`
   - Call `wiring.sessionManager.resume(taskBranchId)`
   - Return updated `TaskBranch`
   - On `SessionBrokenError`: return `{ error: 'broken', message: '...' }`

3. `session.delete`:
   - Params: `{ taskBranchId: string, force?: boolean }`
   - Call `wiring.sessionManager.delete(taskBranchId, { force: force ?? false })`
   - On `UncommittedChangesError`: return `{ error: 'uncommitted_changes' }`

4. `session.hasUncommittedChanges`:
   - Params: `{ taskBranchId: string }`
   - Return `{ hasUncommittedChanges: boolean }`

**Files**: `apps/desktop-companion/src/sidecar/services.ts`

**Validation**:
- [ ] `session.list` returns all non-deleted TaskBranches
- [ ] `session.resume` of broken record → structured error response
- [ ] `session.delete` with uncommitted + `force: false` → structured error (not crash)

---

### T024 — Register `session.getMode` / `session.setMode`

**Purpose**: Expose operating mode management to the UI.

**Steps**:

1. `session.getMode`:
   - Params: `{ repoPath?: string }`
   - Return `{ mode: 'managed' | 'advisory' }`

2. `session.setMode`:
   - Params: `{ mode: 'managed' | 'advisory', repoPath?: string }`
   - Call `wiring.sessionManager.setMode(mode, repoPath)`
   - Return `{ ok: true }`
   - Validate `mode` is one of the two valid values

**Files**: `apps/desktop-companion/src/sidecar/services.ts`

**Validation**:
- [ ] `setMode` with invalid value → error response
- [ ] `getMode` returns repo-specific mode when set
- [ ] `getMode` returns global mode when no repo override

---

### T025 — Drift Signal → `state.driftSignal` Tauri Event

**Purpose**: Emit drift signals from the detector to the Tauri WebView layer.

**Steps**:

1. In `sessionWiring.ts`, after `sessionManager.onFileModification` completes, call the drift detector:

```typescript
detector.onModification(async (event) => {
  const existing = await store.findBySessionId(event.sessionId);
  if (existing === undefined) return;
  const signal = await driftDetector.observe({
    taskBranchId: existing.id,
    filePath: event.filePath,
    sessionStartedAt: existing.createdAt,
  });
  if (signal !== null) {
    sendNotification('state.driftSignal', {
      taskBranchId: signal.taskBranchId,
      confidence: signal.confidence,
      heuristics: signal.heuristics,
      explanation: signal.explanation,
    });
  }
});
```

2. The `sendNotification` call is the Tauri IPC channel (injected in T021).

3. Advisory mode: still observe (so advisory suggestions work) but `sessionManager.onFileModification` skips worktree creation (enforced in WP02).

**Files**: `apps/desktop-companion/src/sidecar/sessionWiring.ts`

**Validation**:
- [ ] Drift signal generated → `state.driftSignal` notification sent
- [ ] No signal → no notification
- [ ] Advisory mode still evaluates drift (signal emitted for suggestions)

---

### T026 — Shutdown Handlers

**Purpose**: Gracefully stop all polling on SIGTERM/SIGINT, following the `controlPlaneWiring.ts` pattern.

**Steps**:

1. In `sessionWiring.ts`, expose `shutdown()` function:
```typescript
async function shutdown() {
  // Stop polling for all active sessions
  const branches = await store.listAll();
  for (const branch of branches.filter(b => b.status === 'active')) {
    detector.stopPolling(branch.sessionId);
  }
}
```

2. In `apps/desktop-companion/src/sidecar/main.ts` (or wherever shutdown is handled), call `wiring.shutdown()` in the SIGTERM/SIGINT handler.

3. Use `process.once` (not `process.on`) to prevent double-handling — same pattern as `controlPlaneWiring.ts`.

**Files**: `apps/desktop-companion/src/sidecar/sessionWiring.ts`, `apps/desktop-companion/src/sidecar/main.ts`

**Validation**:
- [ ] `shutdown()` stops polling for all active sessions
- [ ] `process.once` used (not `process.on`)
- [ ] Shutdown completes without throwing

---

### T027 — Unit Tests

**Purpose**: 100% coverage for `sessionWiring.ts` and the new `services.ts` registrations.

**Test files**: `apps/desktop-companion/test/sessionWiring.test.ts`

**Approach**: Mock `openTaskBranchStore`, `createSessionManager`, `createDriftDetector`, `FileModificationDetector` via `vi.mock`. Assert:
- All IPC methods are registered
- `session.fileModified` calls `detector.handleIpcEvent`
- Drift signal → `sendNotification` called with correct payload
- `session.delete` with `UncommittedChangesError` → structured error response
- Shutdown stops polling for active branches

**Validation**:
- [ ] `pnpm coverage` at 100% for `sessionWiring.ts`
- [ ] `pnpm typecheck` passes

## Definition of Done

- [ ] `sessionWiring.ts` created
- [ ] `services.ts` updated with all session IPC methods
- [ ] All methods: `session.fileModified`, `session.list`, `session.resume`, `session.delete`, `session.hasUncommittedChanges`, `session.getMode`, `session.setMode`
- [ ] `state.driftSignal` Tauri notification wired
- [ ] Shutdown handler registered
- [ ] `pnpm coverage` at 100%
- [ ] `pnpm typecheck` passes

## Risks

- **`execGit` on PATH**: The sidecar's Node.js process may not have `git` on PATH if the shell environment differs. The `execFile('git', ...)` call will throw — this should be caught in `initialize()` and surfaced as a startup warning, not a crash.
- **`sendNotification` contract**: Confirm the exact signature in `ipc-handler.ts` before writing T025. The method, params shape, and notification routing must match what the UI subscribes to.
- **Circular dependency risk**: `sessionWiring.ts` imports from both `packages/session-manager` and `packages/drift-detector`. Keep it as a pure wiring file — no business logic.

## Activity Log

- 2026-03-19T00:00:00Z – spec-kitty – lane=planned – Work package created
