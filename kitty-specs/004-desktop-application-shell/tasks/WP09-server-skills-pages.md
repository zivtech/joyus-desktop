---
work_package_id: WP09
title: Server & Skills Pages
dependencies: []
subtasks: [T039, T040, T041]
history:
- date: '2026-03-14'
  event: created
  note: Generated from spec-kitty.tasks
authoritative_surface: src/ui/
execution_mode: code_change
mission_id: 01KPR4E967F61H0B7K24440QG2
owned_files:
- src/ui/components/ServerCard.tsx
- src/ui/pages/Servers.tsx
- src/ui/pages/Skills.tsx
wp_code: WP09
---

# WP09 — Server & Skills Dashboard Pages

**Objective**: Build the dedicated Servers and Skills pages with full CRUD controls for server management and detailed skill information display.

**Implementation command**: `spec-kitty implement WP09 --base WP08`

## Context

The Servers page is the primary operational view — users manage MCP server lifecycle here. The Skills page provides visibility into what's synced and available. Both use the IPC hooks from WP08 and shared components.

---

## Subtask T039: Servers Page

**Steps**:
1. Create `apps/desktop-companion/src/ui/pages/Servers.tsx`:
   - Header: "MCP Servers" with server count and Chrome availability notice
   - Server list using `ServerCard` component from WP08
   - Each card shows: name, status badge, PID, version, uptime, restart count, last error
   - Action buttons per server: Start (when stopped), Stop (when running), Restart (when running)
   - Error display: if a server is in error state, show the error message prominently
   - Chrome warning: if `chrome.detect` returns `available: false`, show info banner explaining which MCPs are unavailable
2. Use `useServerStatus` hook for data and real-time updates
3. Add loading skeleton while initial data loads
4. Add empty state: "No servers registered" with guidance

**Files**:
- `apps/desktop-companion/src/ui/pages/Servers.tsx` (new, ~120 lines)

**Validation**:
- [ ] All registered servers appear with correct status
- [ ] Start/Stop/Restart buttons work and update UI optimistically
- [ ] Error states are displayed clearly
- [ ] Chrome availability warning appears when Chrome is missing

---

## Subtask T040: Skills Page

**Steps**:
1. Create `apps/desktop-companion/src/ui/pages/Skills.tsx`:
   - Header: "Skills" with total count and current version
   - Sync status banner: shows last sync time, current version, sync state
   - Skill table using `SkillList` component: name, version, bundle, file path
   - Search/filter input for skill name
   - "Sync Now" button that triggers `invoke("trigger_sync")`
   - Sync progress indicator during active sync
2. Use `useSyncStatus` hook and `invoke("get_skills")` for data
3. Empty state: "No skills synced yet — run sync to get started"

**Files**:
- `apps/desktop-companion/src/ui/pages/Skills.tsx` (new, ~100 lines)

**Validation**:
- [ ] All synced skills appear in the table
- [ ] Search filters skills by name
- [ ] "Sync Now" triggers sync and shows progress
- [ ] Sync completion updates the skill list

---

## Subtask T041: Wire Server Actions to Tauri Commands

**Steps**:
1. In `ServerCard` component, wire buttons to Tauri commands:
   - Start: `invoke("start_server", { name })` → update local state optimistically → revert on error
   - Stop: `invoke("stop_server", { name })` → same pattern
   - Restart: `invoke("restart_server", { name })` → same pattern
2. Show loading spinner on the card during the operation
3. Show toast/notification on success or error
4. Disable buttons during pending operations (prevent double-click)

**Files**:
- Update `apps/desktop-companion/src/ui/components/ServerCard.tsx` (~30 lines added)

**Validation**:
- [ ] Start button spawns a stopped server
- [ ] Stop button terminates a running server
- [ ] Restart button cycles a running server
- [ ] Double-click prevention works
- [ ] Errors show user-friendly messages

---

## Definition of Done

- [ ] Servers page shows all servers with real-time status
- [ ] Server CRUD actions work from the UI
- [ ] Skills page shows all synced skills
- [ ] Sync can be triggered from Skills page
- [ ] Chrome availability warning displays when applicable

## Activity Log

- 2026-03-15T00:13:42Z – agent-wp09 – shell_pid=52414 – lane=doing – Started implementation via workflow command
- 2026-03-15T00:16:54Z – agent-wp09 – shell_pid=52414 – lane=done – Server and Skills pages with action controls. Committed.
