---
work_package_id: WP06
title: Engagement Dashboard Frontend
dependencies:
- WP01
- WP03
requirement_refs:
- FR-001
- FR-003
- FR-004
- FR-007
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts generated on main. During implementation, this WP may branch from a dependency-specific base. Completed changes must merge back into main.
subtasks:
- T024
- T025
- T026
- T027
- T028
history:
- date: '2026-05-10'
  event: created
  note: Generated via /spec-kitty.tasks
authoritative_surface: apps/desktop-companion/src/ui/pages/ReconDashboard.tsx
execution_mode: code_change
mission_id: 01KRA2P11PNXGNMMJQYQYP34M8
owned_files:
- apps/desktop-companion/src/ui/pages/ReconDashboard.tsx
- apps/desktop-companion/src/ui/components/EngagementStatus.tsx
- apps/desktop-companion/src/ui/App.tsx
tags: []
wp_code: WP06
---

# WP06: Engagement Dashboard Frontend

## Overview

Create the main Recon Operator UI: a dashboard for launching new engagements, tracking active analysis in real time, and exporting completed output after a sensitive-content scan gate. The full flow (New Engagement → launch → live progress → completion → scan → export) must work without the operator ever opening a terminal.

## Codebase Pattern

Pages live in `apps/desktop-companion/src/ui/pages/`. All main pages render inside `<Layout>` via `MemoryRouter`. IPC uses `safeInvoke<T>(cmd, args)` and `safeListen<T>(event, handler)` (lazy-imported from `@tauri-apps/api`), defined locally per page. State is `useState` + `useCallback` + `useEffect`. Named exports only. Inline CSS `style={{...}}`. Color palette: `#1a73e8` primary, `#22c55e` success, `#f59e0b` warning, `#ef4444` error, `#6b7280` muted, `#e5e7eb` borders, `#f9fafb` bg. Existing page references: `Servers.tsx`, `Sessions.tsx`.

## Subtasks

### T024 — Create `ReconDashboard.tsx` with new-engagement form

Create `apps/desktop-companion/src/ui/pages/ReconDashboard.tsx`.

**Header**: "Recon Engagements" + "New Engagement" button (primary, `#1a73e8`).

**New Engagement inline form** (shown when "New Engagement" clicked, hidden otherwise):
- Client Name: `<input type="text">`, required.
- URL: `<input type="url">`, required. Validate with `new URL(value)` — show inline error if invalid.
- Access Mode: `<select>` with options `rfp` (default), `discovery`, `full`. Display labels: "RFP (limited)", "Discovery", "Full Access".
- "Start Engagement" button: disabled until both required fields pass validation.
- On submit: call `safeInvoke<{ engagementDir: string; engagementId: string }>("create_engagement", { clientName, url, accessMode })`, then immediately call `safeInvoke("launch_recon", { clientName, engagementDir })`. On success: hide form, render `<EngagementStatus engagementId={...} engagementDir={...} />` as the active view. On error: show inline error banner (red, dismissible).
- "Cancel" link closes the form without action.

**Past engagements list** (below form or active status view):
- On mount: call `safeInvoke<{ engagements: ReconMeta[] }>("list_engagements", {})`. (Document that WP01/WP03 must add a `list_engagements` Tauri command that scans `~/Documents/joyus-recon-engagements/` for `.recon-meta.json` files.)
- Each row: client name, URL (truncated), access mode badge, created date, status badge.
- Status badge colors: Running `#1a73e8`, Complete `#22c55e`, Error `#ef4444`, Cancelled `#6b7280`.
- Clicking a past engagement row re-renders `<EngagementStatus>` for that engagement.
- Empty state: "No engagements yet. Start your first engagement above."

**TypeScript types** (define locally):
```ts
interface ReconMeta {
  clientName: string;
  clientSlug: string;
  url: string;
  accessMode: string;
  engagementId: string;
  createdAt: string;
  status?: 'running' | 'complete' | 'error' | 'cancelled';
}
```

### T025 — Create `EngagementStatus.tsx` component

Create `apps/desktop-companion/src/ui/components/EngagementStatus.tsx`.

**Props**: `{ engagementId: string; engagementDir: string; onBack: () => void }`.

**Layout** (card, full-width within dashboard content area):
- Engagement name (from meta, loaded on mount via `safeInvoke("get_engagement_status", { engagementId })`).
- Status badge (Running / Complete / Error / Cancelled) — color-coded per palette above.
- Elapsed time: live counter (`setInterval` every second) showing `Xm Ys` since `createdAt`. Stops when status is non-running.
- Current phase label (e.g., "Crawling", "Analyzing", "Generating report") — derived from latest progress event.
- Progress log: scrollable `<div>` (max-height 240px, `overflow-y: auto`, monospace font, `#f9fafb` bg, `#e5e7eb` border) showing the last 100 log lines. Auto-scrolls to bottom on new entries. Timestamps prepended to each line.
- "Cancel" button (visible only when status is `running`): calls `safeInvoke("cancel_engagement", { engagementId })`. On success: update status badge to Cancelled.
- "Back" button: calls `onBack()`.

**TypeScript types** (define locally):
```ts
interface ReconProgressEvent {
  type: 'tool_use' | 'text' | 'phase' | 'error' | 'done';
  content?: string;
  tool?: string;
  phase?: string;
  timestamp: string;
}

interface EngagementStatus {
  engagementId: string;
  clientName: string;
  status: 'running' | 'complete' | 'error' | 'cancelled';
  createdAt: string;
  currentPhase?: string;
}
```

### T026 — Wire up real-time progress streaming

Extend `EngagementStatus.tsx` with live event streaming.

**Stream subscription** (in `useEffect`, cleanup on unmount):
```ts
const unlisten = await safeListen<ReconProgressEvent>("recon:progress", (event) => {
  // Only handle events matching this engagementId
  if (event.engagementId !== engagementId) return;
  appendLogLine(formatEvent(event));
  if (event.type === 'phase') setCurrentPhase(event.phase ?? '');
  if (event.type === 'done' || event.type === 'error') {
    setStatus(event.type === 'done' ? 'complete' : 'error');
  }
});
return () => { unlisten(); };
```

**Polling fallback** (backup for missed events):
- `setInterval` every 10 seconds: call `safeInvoke<EngagementStatus>("get_engagement_status", { engagementId })`.
- If returned status differs from local state, update status and currentPhase.
- Clear interval when status transitions to a terminal state (complete / error / cancelled).

**`formatEvent` helper** (local function):
- `tool_use`: `"[tool] {event.tool}"`.
- `text`: first 120 chars of `event.content`, ellipsis if truncated.
- `phase`: `"--- Phase: {event.phase} ---"`.
- `error`: `"[error] {event.content}"`.
- `done`: `"--- Engagement complete ---"`.

### T027 — Post-completion scan and export flow

Extend `EngagementStatus.tsx` with the scan gate and export UI.

**Trigger**: when `status === 'complete'`, show a "Scan & Export" card below the progress log.

**"Scan Output" button** (primary):
- Calls `safeInvoke<ScanResult>("recon_scan", { engagementDir })`.
- Loading state: spinner + "Scanning for sensitive content...".
- **PASS**: green banner "Scan passed — no sensitive content detected." + "Export" button (primary).
- **FAIL**: amber banner "Scan detected potential issues." + findings list. Each finding shows: `file` (relative path), `line` (number), `pattern` (matched rule). Below list: red "Override (dogfood only)" button with confirmation dialog ("This will export despite scan findings. Only use during internal dogfood testing. Continue?"). Confirming sets `overrideScan = true` and enables "Export".

**"Export" button** (enabled after PASS or override):
- Calls `safeInvoke<{ zipPath: string; sizeBytes: number }>("recon_export", { engagementDir, overrideScan })`.
- On success: green confirmation card showing zip path + human-readable file size (e.g., "3.2 MB"). "Open in Finder" button → `safeInvoke("open_in_finder", { path: zipPath })` (or equivalent shell-open Tauri command).
- On error: red inline error with message.

**TypeScript types** (define locally):
```ts
interface ScanFinding {
  file: string;
  line: number;
  pattern: string;
}
interface ScanResult {
  passed: boolean;
  findings: ScanFinding[];
}
```

**Proxy command note**: `recon_scan` and `recon_export` must be Rust Tauri commands that proxy to the sidecar. Either add them as Rust proxy commands in WP03's scope (preferred — document this as a cross-WP dependency), or handle via an existing sidecar passthrough mechanism if one exists. The frontend calls `safeInvoke("recon_scan", ...)` — the Rust layer must route this to the sidecar's `recon.scan` / `recon.export` handlers (added in WP01).

### T028 — Add routes and nav link in `App.tsx`

Modify `apps/desktop-companion/src/ui/App.tsx`.

**Add routes inside `<Layout>`**:
```tsx
<Route path="/recon" element={<ReconDashboard />} />
```

**Add `<ReconSetup>` route outside `<Layout>`** (matches Onboarding pattern):
```tsx
<Route path="/recon/setup" element={<ReconSetup />} />
```

**Add "Recon" nav link** in the Layout sidebar. Inspect the Layout component for the existing nav link pattern (likely an array of `{ path, label, icon }` or JSX `<NavLink>` elements) and add the Recon entry using the same pattern. Icon: use an existing icon that suggests analysis/scan (e.g., magnifying glass or chart), or a plain text label if the nav uses text-only links.

**Route guard**: In `App.tsx` (or in `ReconDashboard.tsx` via `useEffect`), import `useReconSetup` from `../hooks/useRecon`. If `setupComplete === false && !loading`, use MemoryRouter's `useNavigate` to redirect from `/recon` to `/recon/setup`. This guard fires on initial render — the operator sees the setup wizard, not a broken dashboard.

**Import guard**: All new page/component imports must be lazy if the existing App.tsx uses `React.lazy` — match the existing pattern.

## Success Criteria

1. Full flow completes without Terminal: New Engagement form → launch → live progress log → status transitions to Complete → Scan Output → PASS → Export → zip path shown.
2. Scan FAIL path shows specific findings (file/line/pattern) and an override button with a confirmation dialog.
3. Progress log updates in real time during active engagements; polling fallback keeps status accurate if stream events are missed.
4. Past engagements persist across app restarts and are listed on dashboard load.
5. Route guard redirects unauthenticated/unconfigured operators to `/recon/setup` automatically.
6. No TypeScript compilation errors. No unhandled promise rejections in the browser console.
