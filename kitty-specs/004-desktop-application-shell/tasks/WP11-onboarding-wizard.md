---
work_package_id: WP11
title: Onboarding Wizard
dependencies: []
subtasks: [T045, T046, T047, T048]
history:
- date: '2026-03-14'
  event: created
  note: Generated from spec-kitty.tasks
authoritative_surface: src/
execution_mode: code_change
mission_id: 01KPR4E967F61H0B7K24440QG2
owned_files:
- src/commands.rs
- src/ui/App.tsx
- src/ui/components/OnboardingStep.tsx
- src/ui/pages/Onboarding.tsx
wp_code: WP11
---

# WP11 — Onboarding Wizard

**Objective**: Build the first-run onboarding flow that guides new users through authentication, MCP server configuration, and initial skill sync.

**Implementation command**: `spec-kitty implement WP11 --base WP08`

## Context

When the app launches for the first time (or when `onboarding_complete` is not set), the onboarding wizard takes over the full window. It walks the user through 4 steps: authenticate → configure MCPs → sync skills → done. Each step can fail independently and supports retry.

---

## Subtask T045: Onboarding Wizard UI

**Steps**:
1. Create `apps/desktop-companion/src/ui/pages/Onboarding.tsx`:
   - Full-window wizard with step indicator (1 of 4, 2 of 4, etc.)
   - **Step 1 — Welcome & Auth**: org name input, auth token input (or OAuth redirect), "Connect" button
   - **Step 2 — MCP Configuration**: automatic — shows progress as MCP servers are registered and started, with per-server status indicators
   - **Step 3 — Skill Sync**: automatic — shows sync progress, downloaded skill count, version
   - **Step 4 — Complete**: success message, "Open Dashboard" button
2. Step transitions:
   - Steps 2 and 3 are automatic after step 1 succeeds
   - Progress bars or spinners during automatic steps
   - Each step shows success checkmark or error X
3. Design: centered card layout, clean and welcoming, Joyus branding

**Files**:
- `apps/desktop-companion/src/ui/pages/Onboarding.tsx` (new, ~150 lines)
- `apps/desktop-companion/src/ui/components/OnboardingStep.tsx` (new, ~40 lines)

**Validation**:
- [ ] Wizard renders all 4 steps
- [ ] Step indicator shows progress
- [ ] Success state shows checkmarks
- [ ] Error state shows error messages

---

## Subtask T046: First-Run Detection

**Steps**:
1. In `App.tsx`, on mount:
   - Call `invoke("get_config", { key: "onboarding_complete" })`
   - If not set or `false`: redirect to `/onboarding`
   - If `true`: show normal dashboard
2. Add Tauri commands for config read/write:
   - `get_config(key: string) -> Option<String>`: SELECT from app_config
   - `set_config(key: string, value: string)`: INSERT OR REPLACE into app_config
3. After onboarding completes, call `set_config("onboarding_complete", "true")`

**Files**:
- Update `apps/desktop-companion/src/ui/App.tsx` (~15 lines)
- Update `apps/desktop-companion/src-tauri/src/commands.rs` (get_config, set_config, ~25 lines)

**Validation**:
- [ ] Fresh install shows onboarding
- [ ] Completed onboarding shows dashboard on next launch
- [ ] Clearing app_config restores first-run behavior

---

## Subtask T047: Wire Onboarding to Sidecar

**Steps**:
1. When user completes Step 1 (auth):
   - Store credentials via `set_config`
   - Call `invoke("start_onboarding", { authToken, tenantId, workspaceId })`
2. The sidecar `onboarding.start` method (implemented in WP06) handles:
   - MCP server registration and startup → progress emitted as events
   - Skill sync → progress emitted as events
   - Claude Code `.mcp.json` configuration
3. Frontend listens to sidecar events to update step progress:
   - `state:server-changed` events → update Step 2 server status
   - `state:sync-completed` event → mark Step 3 complete
4. On completion: set `onboarding_complete: true`, navigate to dashboard

**Files**:
- Update `apps/desktop-companion/src/ui/pages/Onboarding.tsx` (~40 lines)

**Validation**:
- [ ] Auth credentials are stored
- [ ] MCP servers start during onboarding
- [ ] Skills sync during onboarding
- [ ] Dashboard opens after completion

---

## Subtask T048: Error Handling & Partial Recovery

**Steps**:
1. Each onboarding step can fail independently:
   - Step 1 (auth): show error message, keep user on Step 1 with retry
   - Step 2 (MCP config): show which servers failed, offer "Retry Failed" button
   - Step 3 (sync): show sync error, offer "Retry Sync" button
2. Partial progress is preserved:
   - If Step 2 partially succeeds (2 of 5 servers started), don't lose the 2 that worked
   - Retry only attempts the failed servers
3. "Skip" option for Steps 2 and 3: user can proceed to dashboard with partial setup
   - Dashboard will show warnings for unconfigured items
4. If app crashes during onboarding, next launch resumes from last incomplete step

**Files**:
- Update `apps/desktop-companion/src/ui/pages/Onboarding.tsx` (~40 lines)

**Validation**:
- [ ] Auth failure shows retry option
- [ ] Partial MCP failure shows per-server status with retry
- [ ] Sync failure shows retry
- [ ] Skip option works and dashboard shows appropriate warnings
- [ ] Crash during onboarding resumes correctly

---

## Definition of Done

- [ ] First-run detection works
- [ ] All 4 onboarding steps complete successfully
- [ ] Error handling covers all failure modes with retry
- [ ] Partial progress is preserved
- [ ] Skip option available for non-critical steps
- [ ] Dashboard loads after onboarding completion

## Activity Log

- 2026-03-15T00:13:43Z – agent-wp11 – shell_pid=52414 – lane=doing – Started implementation via workflow command
- 2026-03-15T00:17:28Z – agent-wp11 – shell_pid=52414 – lane=done – Onboarding wizard with 4-step flow, first-run detection, error handling with retry/skip.
