---
work_package_id: WP08
title: Dashboard Layout & IPC Hooks
dependencies: []
subtasks: [T035, T036, T037, T038]
history:
- date: '2026-03-14'
  event: created
  note: Generated from spec-kitty.tasks
authoritative_surface: src/ui/
execution_mode: code_change
mission_id: 01KPR4E967F61H0B7K24440QG2
owned_files:
- src/ui/App.tsx
- src/ui/components/Layout.tsx
- src/ui/components/ServerCard.tsx
- src/ui/components/SkillList.tsx
- src/ui/components/StatusBadge.tsx
- src/ui/hooks/useGovernance.ts
- src/ui/hooks/useServerStatus.ts
- src/ui/hooks/useSyncStatus.ts
- src/ui/hooks/useTauriEvent.ts
- src/ui/pages/Dashboard.tsx
- src/ui/styles/**
wp_code: WP08
---

# WP08 — Dashboard Layout & IPC Hooks

**Objective**: Build the React dashboard shell (layout, navigation, routing), create reusable Tauri IPC hooks, build the overview page, and create shared UI components.

**Implementation command**: `spec-kitty implement WP08 --base WP05`

## Context

The dashboard is a React SPA rendered in Tauri's webview. It uses react-router-dom for client-side routing between pages. All data comes from Tauri commands (invoke) and events (listen). This WP creates the foundational layout that all subsequent page WPs build on.

---

## Subtask T035: Dashboard Layout

**Steps**:
1. Update `apps/desktop-companion/src/ui/App.tsx`:
   - Set up react-router-dom with `BrowserRouter` (or `MemoryRouter` for Tauri)
   - Routes: `/` (Dashboard), `/servers` (Servers), `/skills` (Skills), `/governance` (Governance), `/usage` (Usage), `/settings` (Settings), `/onboarding` (Onboarding)
2. Create `apps/desktop-companion/src/ui/components/Layout.tsx`:
   - Sidebar navigation with icon + label for each page
   - Active page highlight
   - Status bar at bottom showing: connection status (sidecar alive), server count, last sync time
   - Main content area with `<Outlet />`
3. Style with CSS modules or inline styles (keep it simple, no heavy CSS framework)
   - Clean, minimal design
   - Light theme (dark theme can be added later)
   - Responsive within window resize constraints (min 800x600)

**Files**:
- Update `apps/desktop-companion/src/ui/App.tsx` (~40 lines)
- `apps/desktop-companion/src/ui/components/Layout.tsx` (new, ~80 lines)
- `apps/desktop-companion/src/ui/styles/` (new, CSS files)

**Validation**:
- [ ] Sidebar navigation shows all pages
- [ ] Clicking nav items routes to correct page
- [ ] Status bar shows sidecar connection status
- [ ] Layout renders correctly at various window sizes

---

## Subtask T036: React Hooks for Tauri IPC

**Steps**:
1. Create `apps/desktop-companion/src/ui/hooks/useTauriEvent.ts`:
   - Wraps `listen(eventName, callback)` from `@tauri-apps/api/event`
   - Cleans up listener on unmount
   - Returns latest event payload
2. Create `apps/desktop-companion/src/ui/hooks/useServerStatus.ts`:
   - Calls `invoke("get_servers")` on mount
   - Subscribes to `state:server-changed` events
   - Merges updates into server list state
   - Returns `{ servers, loading, error, refresh }`
3. Create `apps/desktop-companion/src/ui/hooks/useSyncStatus.ts`:
   - Calls `invoke("get_sync_status")` on mount
   - Subscribes to `state:sync-completed` events
   - Returns `{ status, lastSync, version, refresh }`
4. Create `apps/desktop-companion/src/ui/hooks/useGovernance.ts`:
   - Calls `invoke("get_governance_mode")` and `invoke("get_governance_decisions")` on mount
   - Subscribes to `state:governance-decision` events
   - Returns `{ mode, decisions, refresh }`

**Files**:
- `apps/desktop-companion/src/ui/hooks/useTauriEvent.ts` (new, ~25 lines)
- `apps/desktop-companion/src/ui/hooks/useServerStatus.ts` (new, ~40 lines)
- `apps/desktop-companion/src/ui/hooks/useSyncStatus.ts` (new, ~35 lines)
- `apps/desktop-companion/src/ui/hooks/useGovernance.ts` (new, ~40 lines)

**Validation**:
- [ ] Hooks fetch initial data on mount
- [ ] Real-time events update hook state within 5 seconds
- [ ] Listeners are cleaned up on unmount (no memory leaks)

---

## Subtask T037: Dashboard Overview Page

**Steps**:
1. Create `apps/desktop-companion/src/ui/pages/Dashboard.tsx`:
   - **Server Health** section: cards showing each server with status badge (green/yellow/red)
   - **Skills** section: count of available skills, current version, last sync time
   - **Quick Stats** section: tool calls today, governance decisions today, server uptime
   - **Sync Status** section: current sync state, next sync time
2. Uses `useServerStatus`, `useSyncStatus`, and a `useUsageSummary` hook (calls `invoke("get_usage_summary", { days: 1 })`)
3. Auto-refreshes quick stats every 30 seconds

**Files**:
- `apps/desktop-companion/src/ui/pages/Dashboard.tsx` (new, ~100 lines)

**Validation**:
- [ ] Overview shows server health, skills, stats, sync status
- [ ] Data updates in real-time when server state changes
- [ ] Page loads within 1 second

---

## Subtask T038: Shared UI Components

**Steps**:
1. Create `apps/desktop-companion/src/ui/components/StatusBadge.tsx`:
   - Props: `status: "running" | "stopped" | "error" | "starting"`
   - Renders colored dot + label
2. Create `apps/desktop-companion/src/ui/components/ServerCard.tsx`:
   - Props: `server: ServerInfo`
   - Shows name, status badge, PID, uptime, restart count
   - Action buttons: start/stop/restart (disabled based on current status)
3. Create `apps/desktop-companion/src/ui/components/SkillList.tsx`:
   - Props: `skills: SkillInfo[]`
   - Table: name, version, bundle, path

**Files**:
- `apps/desktop-companion/src/ui/components/StatusBadge.tsx` (new, ~25 lines)
- `apps/desktop-companion/src/ui/components/ServerCard.tsx` (new, ~50 lines)
- `apps/desktop-companion/src/ui/components/SkillList.tsx` (new, ~35 lines)

**Validation**:
- [ ] StatusBadge renders correct colors for each status
- [ ] ServerCard shows all server information
- [ ] SkillList renders skill table correctly

---

## Definition of Done

- [ ] Dashboard layout with sidebar navigation works
- [ ] All IPC hooks fetch data and receive real-time updates
- [ ] Overview page shows comprehensive system health
- [ ] Shared components render correctly
- [ ] Navigation between pages works via router

## Activity Log

- 2026-03-14T23:20:19Z – claude-opus – shell_pid=73262 – lane=doing – Started implementation via workflow command
- 2026-03-14T23:59:49Z – claude-opus – shell_pid=73262 – lane=done – Complete: Dashboard layout, IPC hooks, overview page, shared UI components implemented. All tests pass (968), typecheck clean, 100% coverage.
