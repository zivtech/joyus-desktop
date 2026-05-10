---
work_package_id: WP05
title: Setup Wizard Frontend
dependencies:
- WP02
requirement_refs:
- FR-010
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts generated on main. During implementation, this WP may branch from a dependency-specific base. Completed changes must merge back into main.
subtasks:
- T018
- T019
- T020
- T021
- T022
- T023
history:
- date: '2026-05-10'
  event: created
  note: Generated via /spec-kitty.tasks
authoritative_surface: apps/desktop-companion/src/ui/pages/ReconSetup.tsx
execution_mode: code_change
mission_id: 01KRA2P11PNXGNMMJQYQYP34M8
owned_files:
- apps/desktop-companion/src/ui/pages/ReconSetup.tsx
- apps/desktop-companion/src/ui/components/CredentialForm.tsx
- apps/desktop-companion/src/ui/hooks/useRecon.ts
tags: []
wp_code: WP05
---

# WP05: Setup Wizard Frontend

## Overview

Create the 3-step setup wizard that guides operator Aaron through first-time Recon Operator configuration: Claude Code detection, credential entry, and skill file verification. The wizard runs full-screen outside `<Layout>` — matching the Onboarding page pattern — and must be completed before the main Recon dashboard is accessible.

## Codebase Pattern

Pages live in `apps/desktop-companion/src/ui/pages/`. The Onboarding page is the reference: full-screen, rendered outside `<Layout>`, routed from `App.tsx`. IPC uses `safeInvoke<T>(cmd, args)` (lazy-imported from `@tauri-apps/api`), defined locally per page. State is `useState` + `useCallback` + `useEffect`. Sub-components live in the same file or `src/ui/components/`. Named exports only. Inline CSS `style={{...}}` throughout. Color palette: `#1a73e8` primary, `#22c55e` success, `#f59e0b` warning, `#ef4444` error, `#6b7280` muted, `#e5e7eb` borders, `#f9fafb` bg.

## Subtasks

### T018 — Create `ReconSetup.tsx` with 3-step wizard structure

Create `apps/desktop-companion/src/ui/pages/ReconSetup.tsx`.

**Layout**:
- Full-width card (centered, max-width 640px, `#f9fafb` page bg).
- Step indicator at top: three numbered circles (1, 2, 3) connected by lines. Active step uses `#1a73e8`, completed steps use `#22c55e`, upcoming steps use `#e5e7eb`.
- Step content area in middle (min-height 240px).
- Navigation buttons at bottom: "Back" (disabled on step 1) + "Next" (disabled until current step passes). "Finish" replaces "Next" on step 3 once it passes.

**State**:
- `currentStep: number` (1–3)
- `setupComplete: boolean`
- Per-step `stepStatus: ('idle' | 'checking' | 'pass' | 'fail')[]` — one entry per step.

**Behavior**: Each step renders its own sub-component (StepClaudeDetect, StepCredentials, StepSkillCheck). "Next" button is disabled until `stepStatus[currentStep - 1] === 'pass'`. On "Finish", set `setupComplete = true` and navigate to `/recon`.

Match the Onboarding page: render outside `<Layout>`, full-screen, no sidebar.

### T019 — Step 1: Claude Code detection

Implement sub-component `StepClaudeDetect` (in same file as `ReconSetup.tsx`).

**On mount** (or when "Check Again" clicked): call `safeInvoke<{ found: boolean; version?: string }>("check_claude_binary", {})`. If the Rust command does not exist yet, stub to `safeInvoke` and document that WP03 must add a `check_claude_binary` Tauri command that runs `which claude && claude --version`.

**Found state**: green check icon + "Claude Code found" + version string (e.g., "v1.2.3"). Calls `onPass()` to update parent step status.

**Not found state**: red X icon + "Claude Code not found" + descriptive message ("Install Claude Code to continue. Visit docs.anthropic.com/claude-code.") + "Check Again" button. Does not call `onPass()`.

**Loading state**: spinner + "Detecting Claude Code...".

### T020 — Create `CredentialForm.tsx` component

Create `apps/desktop-companion/src/ui/components/CredentialForm.tsx`.

**Props**: `onComplete: () => void` — called when all required credentials are verified.

**Credential keys** (in display order): `ANTHROPIC_API_KEY`, `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `CRUX_API_KEY`.

**Per-field UI**:
- Label: human-readable name + brief description (e.g., "Anthropic API Key — used to run Claude inside Recon sessions").
- `<input type="password">` for all fields.
- Per-field status indicator: `#22c55e` check (verified), `#ef4444` X (invalid/error), `#6b7280` dash (unchecked/unsaved).
- "Save" button per field → calls `safeInvoke("credentials_save", { key, value })`. On success: mark field as saved (not yet verified). On failure: show inline error.

**"Verify All" button** (full-width, primary): calls `safeInvoke<{ results: Record<string, boolean> }>("credentials_verify", {})`. Updates per-field status based on `results[key]`. If all required keys return `true`: calls `onComplete()`.

**On mount**: calls `safeInvoke<{ keys: Record<string, boolean> }>("credentials_list", {})` to pre-populate `isSet` flags. Fields with `isSet: true` show a saved indicator (gray dash until verified).

**Error handling**: network/IPC errors shown as inline red text below the field or button. Never expose raw error objects.

### T021 — Step 2: Credential entry (uses CredentialForm)

Implement sub-component `StepCredentials` (in same file as `ReconSetup.tsx`).

Renders `<CredentialForm onComplete={onPass} />`. The `onPass` callback sets `stepStatus[1] = 'pass'`, enabling the "Next" button.

Step header copy: "Enter API credentials" + sub-text "These are stored locally on this machine. You will receive them from Alex via Signal."

"Next" is enabled only when all four credential keys are saved: `ANTHROPIC_API_KEY`, `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `CRUX_API_KEY`. The `onComplete` prop on `CredentialForm` fires once all are saved and verified — that is the gating event.

### T022 — Step 3: Skill file check

Implement sub-component `StepSkillCheck` (in same file as `ReconSetup.tsx`).

**On mount** (or when "Check Again" clicked): call `safeInvoke<{ found: boolean }>("check_skill_file", {})`. Document that WP03 must add a `check_skill_file` Tauri command that runs `test -f ~/.claude/skills/joyus-recon.md` and returns `{ found: true/false }`.

**Found state**: green check + "Recon skill installed" + file path. Calls `onPass()`.

**Not found state**: red X + message "Skill file not found. Ask Alex to copy `joyus-recon.md` to `~/.claude/skills/`." + "Check Again" button. Does not call `onPass()`.

**Loading state**: spinner + "Checking skill file...".

### T023 — Create `useReconSetup` hook

Create `apps/desktop-companion/src/ui/hooks/useRecon.ts`.

**Export**: `useReconSetup(): { setupComplete: boolean; missingSteps: string[]; loading: boolean }`.

**On mount**:
1. Call `safeInvoke<{ keys: Record<string, boolean> }>("credentials_list", {})` — check that all four required keys have `isSet: true`.
2. Call `safeInvoke<{ found: boolean }>("check_skill_file", {})` — check skill file.
3. Derive `missingSteps`: include `"credentials"` if any required key is missing; include `"skill"` if skill file not found.
4. `setupComplete = missingSteps.length === 0`.

**Usage in `App.tsx`**: import `useReconSetup` and add a route guard — if `setupComplete === false && !loading`, redirect `/recon` to `/recon/setup`. This ensures incomplete setup is caught on app launch, not just wizard entry.

**Persistence note**: Because `credentials_list` and `check_skill_file` read real filesystem/credential state, a partially completed setup (e.g., credentials saved but skill not installed) will correctly reflect which steps remain on restart.

## Success Criteria

1. A new user can complete the wizard flow in under 5 minutes on a correctly configured machine.
2. All three steps display meaningful pass/fail states with actionable copy for every failure mode.
3. The "Next" / "Finish" button is visually and functionally disabled until the current step passes — no way to advance past a failing step.
4. Partially completed setup (e.g., credentials saved, skill not yet installed) survives app restart: the wizard reopens to the correct remaining step.
5. No TypeScript compilation errors. Component tree renders without console errors on both happy and error paths.
