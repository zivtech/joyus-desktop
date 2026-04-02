---
work_package_id: WP10
title: Governance, Usage & Settings Pages
lane: done
dependencies: []
subtasks: [T042, T043, T044]
agent: agent-wp10
shell_pid: '52414'
review_status: approved
reviewed_by: Alex Urevick-Ackelsberg
history:
- date: '2026-03-14'
  event: created
  note: Generated from spec-kitty.tasks
---

# WP10 — Governance, Usage & Settings Pages

**Objective**: Build the Governance page (mode and decisions), Usage page (30-day analytics), and Settings page (app configuration).

**Implementation command**: `spec-kitty implement WP10 --base WP08`

## Context

These three pages complete the dashboard. Governance provides operational visibility, Usage provides analytics from local SQLite data, and Settings provides app configuration controls.

---

## Subtask T042: Governance Page

**Steps**:
1. Create `apps/desktop-companion/src/ui/pages/Governance.tsx`:
   - Mode indicator: large badge showing current mode (off/audit/enforce) with color coding
   - Description text explaining what the current mode means
   - Recent decisions table:
     - Columns: timestamp, tool name, server name, decision (allow/deny/audit), mode
     - Color-coded rows: green for allow, yellow for audit, red for deny
     - Pagination or virtual scrolling for large lists
   - Filters: filter by decision type, server name, date range
   - Auto-updates via `useGovernance` hook (new decisions appear in real-time)
2. Empty state: "No governance decisions recorded yet"

**Files**:
- `apps/desktop-companion/src/ui/pages/Governance.tsx` (new, ~120 lines)

**Validation**:
- [ ] Current governance mode is displayed correctly
- [ ] Decision table shows recent decisions
- [ ] Filters work (by decision type, server)
- [ ] New decisions appear in real-time

---

## Subtask T043: Usage Page

**Steps**:
1. Create `apps/desktop-companion/src/ui/pages/Usage.tsx`:
   - Summary cards at top: total tool calls, total syncs, governance decisions, server crashes (last 30 days)
   - Daily activity chart: bar chart showing daily event count for the last 30 days
     - Use a lightweight chart library (e.g., recharts, or build with SVG)
   - Top tools ranking: list showing most-used tools with call count
   - Top servers ranking: list showing most-active MCP servers
   - Date range selector: last 7 days, 14 days, 30 days
2. Data from `invoke("get_usage_summary", { days })` and `invoke("query_usage", { ... })`
3. Loading state while queries execute

**Files**:
- `apps/desktop-companion/src/ui/pages/Usage.tsx` (new, ~150 lines)

**Validation**:
- [ ] Summary cards show correct totals
- [ ] Daily chart renders 30-day data
- [ ] Top tools and servers rankings are correct
- [ ] Date range selector updates all views

---

## Subtask T044: Settings Page

**Steps**:
1. Create `apps/desktop-companion/src/ui/pages/Settings.tsx`:
   - **Auto-Start**: toggle switch, calls `invoke("toggle_autostart", { enabled })`
   - **Telemetry**: toggle switch for opt-out, saves to app_config
   - **Sync**: "Sync Now" button with last sync info, calls `invoke("trigger_sync")`
   - **Update**: "Check for Updates" button, shows current version, calls `invoke("check_for_update")`
   - **About**: app name, version, build info
   - **Data**: "Clear Usage Data" button with confirmation dialog, deletes all usage_events
   - **Uninstall Help**: link/text explaining how to fully uninstall (cleanup prompt happens at OS level)
2. Settings persist via Tauri commands that read/write app_config table

**Files**:
- `apps/desktop-companion/src/ui/pages/Settings.tsx` (new, ~130 lines)

**Validation**:
- [ ] Auto-start toggle works and persists
- [ ] Telemetry opt-out toggle works and persists
- [ ] Sync trigger works from settings
- [ ] Update check works from settings
- [ ] Clear data shows confirmation and clears usage_events

---

## Definition of Done

- [ ] Governance page shows mode and decisions with filtering
- [ ] Usage page shows 30-day analytics with charts
- [ ] Settings page provides all configuration controls
- [ ] All settings persist across app restarts

## Activity Log

- 2026-03-15T00:13:42Z – agent-wp10 – shell_pid=52414 – lane=doing – Started implementation via workflow command
- 2026-03-15T00:18:01Z – agent-wp10 – shell_pid=52414 – lane=done – All 3 pages complete: Governance, Usage, Settings.
