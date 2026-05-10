---
work_package_id: WP13
title: Error Recovery UX
dependencies:
- WP07
requirement_refs:
- FR-016
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts for this feature were generated on main. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into main unless the human explicitly redirects the landing branch.
subtasks:
- T049
- T050
- T051
history:
- date: '2026-05-10'
  event: created
  note: Generated via /spec-kitty.tasks
authoritative_surface: apps/desktop-companion/src/ui/components/ErrorRecovery.tsx
execution_mode: code_change
mission_id: 01KRA2P11PNXGNMMJQYQYP34M8
owned_files:
- apps/desktop-companion/src/ui/components/ErrorRecovery.tsx
tags: []
wp_code: WP13
---

# WP13: Error Recovery UX

## Overview

Eliminate silent failure states from the Recon Operator feature. Every error condition — timeout, crash, stuck process, scan violation — must present the user with a clear status and at least one actionable next step. This WP adds the timeout alert, crash recovery banner, and scan failure UX. It integrates with `EngagementStatus.tsx` (introduced in WP06) without owning that file.

**Ownership note**: `EngagementStatus.tsx` is owned by WP06. WP13 depends on WP07, which depends on WP06 — so WP06 is merged before WP13 runs. WP13 adds a new component (`ErrorRecovery.tsx`) that `EngagementStatus.tsx` imports; WP13 does not edit `EngagementStatus.tsx` directly. If integration requires a one-line import + render addition to `EngagementStatus.tsx`, that is acceptable as a minimal touch on a non-owned file — document clearly in the PR.

## Codebase Pattern

Frontend components in `apps/desktop-companion/src/ui/components/`. Inline `style={{...}}` CSS only. IPC via `safeInvoke` / `safeListen`. Engagement metadata stored in `~/Documents/joyus-recon-engagements/{slug}/.recon-meta.json`. Completion sentinel at `{engagementDir}/.recon-complete`.

## Subtasks

### T049 — Timeout alert

Add timeout detection logic to the engagement monitoring flow. The engagement is considered timed out when: the tracked process has exited (or no PID is tracked) AND `.recon-complete` is absent AND 2 hours have elapsed since `createdAt` in `.recon-meta.json`.

**Implementation**:
1. In `ErrorRecovery.tsx`, export a `TimeoutAlert` component:
   ```tsx
   interface TimeoutAlertProps {
     engagementDir: string;
     engagementName: string;
     onMarkFailed: () => void;
     onKeepWaiting: (extraHours: number) => void;
   }
   ```
2. The alert renders as a dismissable modal or inline banner (implementer's choice — inline banner preferred to avoid blocking the UI). Content: "Engagement '{name}' may be stuck — it's been running for over 2 hours with no completion signal."
3. Three action buttons:
   - "Check Terminal" — calls `safeInvoke("open_terminal")` (or `shell.open("x-apple.systempreferences:")` via Tauri shell plugin if a sidecar command is not available; check existing usage in the codebase for the right mechanism).
   - "Mark as Failed" — calls `safeInvoke("write_error_sentinel", { engagementDir, reason: "timeout" })`, then calls `onMarkFailed()`. The error sentinel is a `.recon-failed.json` file at `{engagementDir}/` with `{ failedAt, reason }`.
   - "Keep Waiting" — dismisses the alert for 1 additional hour, then re-shows if still incomplete. Calls `onKeepWaiting(1)`.
4. If the process is still running at the 2-hour mark (PID tracked and alive), show an informational banner instead of an alert: "Engagement still running (2h elapsed)." No action buttons — just dismiss.

Integrate by having the engagement status polling in `EngagementStatus.tsx` call back into `ErrorRecovery.TimeoutAlert` when the timeout condition is detected. Use a prop or context — do not introduce a global store.

### T050 — Crash recovery

On Desktop app launch, scan for incomplete engagements (engagements with a `.recon-meta.json` but no `.recon-complete` and no actively tracked running PID).

**Implementation**:
1. In `ErrorRecovery.tsx`, export a `CrashRecoveryBanner` component.
2. On mount, call `safeInvoke("scan_incomplete_engagements")`. This returns `Array<{ engagementDir: string, engagementName: string, createdAt: string }>`.
3. For each incomplete engagement, render a banner: "Incomplete engagement: '{name}' (started {date})" with two buttons:
   - "Mark as Failed" — calls `safeInvoke("write_error_sentinel", { engagementDir, reason: "app_crash" })`.
   - "Abandon" — shows a confirmation dialog: "This will permanently delete the engagement directory. Proceed?" On confirm: calls `safeInvoke("delete_engagement", { engagementDir })`.
4. After either action, remove that engagement from the banner list (update local state).
5. If there are no incomplete engagements, render nothing (null).

The `scan_incomplete_engagements` sidecar handler (to be implemented as part of this WP or confirmed as already existing from WP01/WP06):
- Reads all subdirectories under `~/Documents/joyus-recon-engagements/`.
- For each: check for `.recon-meta.json` (must exist), `.recon-complete` (must be absent), and whether the PID in `.recon-meta.json` (if any) is still alive via `process.kill(pid, 0)` (no-op signal to check existence).
- Returns entries that match all three conditions.

Render `<CrashRecoveryBanner />` in `ReconDashboard.tsx` (or the top-level Recon page) above the engagement form — the same location as `ReadinessMatrix` from WP12, but above it.

**`.recon-meta.json` schema extension** — add `pid?: number` field, written by `launch_recon` (WP03/WP07) when the child process is started. This is a minimal touch to the launch flow; coordinate with WP07 ownership.

### T051 — Scan failure UX

When `recon.scan` returns `{ passed: false, findings }`, the user must see each finding with context and have a path to either fix it or explicitly override.

**Implementation**:
1. In `ErrorRecovery.tsx`, export a `ScanFailurePanel` component:
   ```tsx
   interface ScanFailurePanelProps {
     findings: Array<{ file: string; line: number; pattern: string; preview: string }>;
     engagementDir: string;
     onAllOverridden: () => void;
   }
   ```
   Note: the `preview` field (text excerpt around the matched line) should be added to the `recon.scan` response if not already present — extract 80 characters centered on the match.
2. Render each finding as a row:
   - File path (relative to `engagementDir`) + line number
   - Pattern name (e.g., `"ANTHROPIC_API_KEY"`)
   - Text preview (truncated to 80 chars, sensitive value replaced with `***` in the preview — never show the actual credential value)
   - "View in Context" button: calls `safeInvoke("open_file_at_line", { filePath, line })` — opens the file in the system default editor at the specified line. Use `shell.open(filePath)` via Tauri shell plugin if a line-number deep-link is not available; document the limitation.
   - "Override" button: opens an inline confirmation sub-row with a reason text field (required, min 10 chars) and a "Confirm Override" button. On confirm: calls `safeInvoke("write_scan_override", { engagementDir, finding, reason })`. The handler writes to `{engagementDir}/.scan-overrides.json` — append to the array if the file exists, create it if not. Each entry: `{ timestamp: ISO-8601, finding: { file, line, pattern }, reason: string, action: "overridden" }`. After writing, mark the finding as overridden in local state (gray out the row, change button to "Overridden").
3. When all findings are overridden (all rows in `'overridden'` state): call `onAllOverridden()` to allow export to proceed.
4. Render `ScanFailurePanel` in the export flow (wherever `recon.export` results are surfaced — integrate with the existing export UI or add a dedicated panel in `ReconDashboard.tsx`).

Never show the actual credential value in any UI element — only pattern names and redacted previews.

## Success Criteria

- A simulated timeout (manually setting `createdAt` 2+ hours in the past in `.recon-meta.json` while no `.recon-complete` exists) triggers the timeout alert with all three action buttons functional.
- "Mark as Failed" writes a parseable `.recon-failed.json` and clears the engagement from active state.
- On Desktop launch, one or more incomplete engagements (no sentinel, no live PID) show the crash recovery banner with working "Mark as Failed" and "Abandon" (with confirmation) actions.
- Scan findings render with redacted previews (no raw credential values visible), working "View in Context" and "Override" buttons.
- Override audit entries are written to `.scan-overrides.json` with all required fields.
- All overriding a finding → `onAllOverridden()` called → export proceeds.
- No unhandled promise rejections in any error recovery flow.
- TypeScript compiles without errors.
