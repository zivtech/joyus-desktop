---
work_package_id: WP12
title: Readiness Matrix UI
dependencies:
- WP08
- WP09
requirement_refs:
- FR-015
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts generated on main. During implementation, this WP may branch from a dependency-specific base. Completed changes must merge back into main.
subtasks:
- T047
- T048
history:
- date: '2026-05-10'
  event: created
  note: Generated via /spec-kitty.tasks
authoritative_surface: apps/desktop-companion/src/ui/components/ReadinessMatrix.tsx
execution_mode: code_change
mission_id: 01KRA2P11PNXGNMMJQYQYP34M8
owned_files:
- apps/desktop-companion/src/ui/components/ReadinessMatrix.tsx
tags: []
wp_code: WP12
---

# WP12: Readiness Matrix UI

## Overview

Build the `ReadinessMatrix` component — a preflight checklist panel that surfaces the real-time state of every dependency the Recon Operator needs before launching an engagement. Items in a critical (red) state block the "New Engagement" button; items in a warning (yellow) state allow launch but display an indicator.

## Codebase Pattern

Frontend components live in `apps/desktop-companion/src/ui/components/`. React 19 functional components with inline `style={{...}}` CSS. IPC calls use `safeInvoke` and `safeListen` from the IPC utilities. No external CSS files — all styling inline. Components are imported into the relevant dashboard/page component.

## Subtasks

### T047 — Create `ReadinessMatrix.tsx`

Create `apps/desktop-companion/src/ui/components/ReadinessMatrix.tsx`.

**Component interface**:
```tsx
interface ReadinessMatrixProps {
  onPreflightComplete?: (allClear: boolean) => void;
}
```

**State**:
- `items: ReadinessItem[]` — list of checked items with their current status.
- `checking: boolean` — true while preflight is running.

**`ReadinessItem` type**:
```tsx
interface ReadinessItem {
  id: string;
  label: string;
  status: 'ready' | 'blocking' | 'warning' | 'unchecked';
  detail: string | null; // e.g., version string, count, date
}
```

**Rows** — each maps to an IPC call:

| Row | IPC call | Ready condition | Blocking condition | Warning condition |
|-----|----------|-----------------|-------------------|-------------------|
| Claude Code | `safeInvoke("check_claude_code")` | `{ installed: true, version: string }` | `installed: false` | — |
| Credentials | `safeInvoke("keychain_list")` | all 5 keys present | any required key missing | — |
| Recon skill | `safeInvoke("get_sync_status", { bundle: "recon-operator-bundle" })` | `status: "synced"`, version present | — | `status !== "synced"` or version null |
| DataForSEO | `safeInvoke("verify_dataforseo")` | `{ valid: true }` | — | `valid: false` or error |
| Last engagement | `safeInvoke("get_last_engagement")` | any result (never blocking/warning) | — | — |

For "Credentials": treat `ANTHROPIC_API_KEY`, `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` as required (blocking if missing). `GITHUB_TOKEN` and `OPENAI_API_KEY` as optional (no status impact).

**Rendering**:
- Render as a card-style panel with a title "System Readiness".
- Each row: colored indicator dot + label + detail text on one line.
- Dot colors: green (`#22c55e`) for ready, red (`#ef4444`) for blocking, yellow (`#eab308`) for warning, gray (`#9ca3af`) for unchecked.
- "Run Preflight" button at the bottom of the panel. On click: set `checking: true`, run all five IPC calls in parallel via `Promise.all`, update `items` with results, set `checking: false`. The entire parallel check must complete in under 5 seconds — add a 5000ms timeout per call via `Promise.race` with a timeout rejection.
- While `checking: true`: disable the button and show "Checking…" label.
- After preflight: call `onPreflightComplete(allClear)` where `allClear` is true when no items have `status: 'blocking'`.

All styling inline. Use `style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16, background: '#1e1e2e', borderRadius: 8 }}` (or match the existing design system colors used elsewhere in the app).

### T048 — Engagement blocking logic and ReconDashboard integration

**Blocking logic in `ReadinessMatrix.tsx`**:

Critical items (status `'blocking'`) prevent engagement creation. The component exposes a computed `hasCriticalItems: boolean` derived from `items`. This is surfaced via the `onPreflightComplete` callback and can also be derived by the parent from the component's rendered state.

Blocking conditions:
- Claude Code not installed → `'blocking'`
- Any required credential key missing from Keychain → `'blocking'`

Warning-only conditions (allow launch, show indicator):
- DataForSEO unverified or invalid → `'warning'`
- Recon skill version unknown or sync status not `"synced"` → `'warning'`
- Last engagement not found → `'unchecked'` (informational only, never blocks)

**Integration into `ReconDashboard.tsx`** (or the equivalent top-level Recon page component):

1. Import and render `<ReadinessMatrix onPreflightComplete={setCanLaunch} />` above the engagement form / "New Engagement" button.
2. Add state: `const [canLaunch, setCanLaunch] = useState(false)`.
3. Apply to the "New Engagement" button:
   ```tsx
   <button
     disabled={!canLaunch}
     style={{ opacity: canLaunch ? 1 : 0.5, cursor: canLaunch ? 'pointer' : 'not-allowed' }}
   >
     New Engagement
   </button>
   ```
4. When `canLaunch` is false, render a helper text below the button: "Complete required items above before starting an engagement." Use `style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}`.
5. Preflight runs automatically on component mount (call the preflight logic on `useEffect([], [])`). The button is disabled until preflight completes.

## Success Criteria

- `ReadinessMatrix` renders all five rows with correct initial `'unchecked'` state before preflight runs.
- "Run Preflight" executes all five IPC calls in parallel and populates statuses in under 5 seconds on a local machine.
- Red (blocking) items disable the "New Engagement" button with the helper text visible.
- Yellow (warning) items do not disable the button but the dot is yellow.
- Simulating a missing required credential key (via `keychain_delete`) causes the Credentials row to go red and the button to disable.
- TypeScript compiles without errors.
- No external CSS files introduced — all styling inline.
