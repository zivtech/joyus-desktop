---
work_package_id: WP09
title: Skill-Sync Recon Bundle
dependencies: []
requirement_refs:
- FR-012
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts for this feature were generated on main. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into main unless the human explicitly redirects the landing branch.
subtasks:
- T036
- T037
- T038
- T039
history:
- date: '2026-05-10'
  event: created
  note: Generated via /spec-kitty.tasks
authoritative_surface: apps/desktop-companion/config/distribution-config.json
execution_mode: code_change
mission_id: 01KRA2P11PNXGNMMJQYQYP34M8
owned_files:
- apps/desktop-companion/config/distribution-config.json
tags: []
wp_code: WP09
---

# WP09: Skill-Sync Recon Bundle

## Overview

Register the `recon-operator-bundle` in `distribution-config.json` so the skill-sync mechanism can pull the joyus-recon skill and its companion `scan-sensitive-output.mjs` script from the joyus-recon repo. Wire the setup wizard and the engagement status component to surface sync state and version to the user.

## Codebase Pattern

Bundle configuration lives in `apps/desktop-companion/config/distribution-config.json`. Existing entries (e.g., `pm-bundle`, `developer-bundle`) define the schema to match. Sync is triggered via `safeInvoke("trigger_sync")` from the frontend. Sync status is retrieved via `safeInvoke("get_sync_status")`. Frontend components use inline `style={{...}}` CSS and call IPC via `safeInvoke` / `safeListen`.

## Subtasks

### T036 — Add `recon-operator-bundle` to `distribution-config.json`

Open `apps/desktop-companion/config/distribution-config.json`. Inspect the existing bundle entries (`pm-bundle`, `developer-bundle`, or equivalent) to confirm the exact schema fields used.

Add a new bundle entry that follows the same schema:

```json
{
  "id": "recon-operator-bundle",
  "displayName": "Recon Operator",
  "description": "joyus-recon skill and output scan script for site architecture discovery engagements.",
  "files": [
    {
      "source": "joyus-recon/skills/joyus-recon.md",
      "destination": "skills/joyus-recon.md"
    },
    {
      "source": "joyus-recon/scripts/scan-sensitive-output.mjs",
      "destination": "resources/scan-sensitive-output.mjs"
    }
  ]
}
```

Adjust field names to match the schema of the existing entries. Do not invent new schema fields — use only what the existing entries use. If the existing schema uses a different nesting or naming convention, match it exactly.

### T037 — Configure source repo and version pinning

Within the `recon-operator-bundle` entry, configure tag-based version pinning against the joyus-recon repo:

- Repository: `joyus-ai/joyus-recon` (or the appropriate org/repo slug — check existing bundles for the org format).
- Pin to a specific tag (e.g., `v1.0.0`). Use a placeholder tag if the repo has not yet published a release, and add a `// TODO: update tag after first release` comment if the config format supports comments, or a sibling `"_note"` field if it does not.
- Follow whatever version-pin mechanism the existing bundles use (e.g., a `"version"` field, a `"tag"` field, a `"ref"` field).

Both files (`joyus-recon.md` and `scan-sensitive-output.mjs`) must be pulled from the same tag.

### T038 — Wire sync trigger into ReconSetup.tsx Step 3

In the setup wizard component (`apps/desktop-companion/src/ui/components/ReconSetup.tsx` or equivalent), locate Step 3 (skill verification / skill install step).

Replace any passive file-existence check with an active sync call:

1. On entering Step 3, call `safeInvoke("trigger_sync", { bundle: "recon-operator-bundle" })`.
2. While sync is in progress, display a loading indicator (spinner or progress text) with the message "Syncing Recon Operator skill…".
3. On success, display: "Recon Operator v{version} ready" where `version` comes from the sync result payload.
4. On failure, display: "Skill sync failed. Check your internet connection." with a "Retry" button that re-invokes `trigger_sync`, and a "Skip (manual install)" link that advances past Step 3 with a warning state.

Use inline `style={{...}}` for all styling, consistent with the existing component style.

### T039 — Add version display to EngagementStatus.tsx

In `apps/desktop-companion/src/ui/components/EngagementStatus.tsx` (or wherever the current engagement status panel lives):

1. On component mount, call `safeInvoke("get_sync_status", { bundle: "recon-operator-bundle" })`.
2. Store the result in local state: `{ version: string | null, syncedAt: string | null, status: "synced" | "unknown" | "error" }`.
3. Render a status line in the panel:
   - If `status === "synced"`: "Recon skill v{version} (synced {syncedAt})" — use a green indicator dot.
   - If `status === "unknown"`: "Recon skill: version unknown" — use a gray indicator dot.
   - If `status === "error"`: "Recon skill: sync error" — use a yellow indicator dot with a "Re-sync" button.
4. The status line should appear below the engagement details and above any action buttons.

Use inline `style={{...}}` for all styling. Do not introduce a new CSS file.

## Success Criteria

- `pnpm skill-sync:tester` (or the equivalent skill-sync test command) passes with `recon-operator-bundle` included.
- A fresh install pulls both `joyus-recon.md` and `scan-sensitive-output.mjs` via the sync mechanism.
- ReconSetup.tsx Step 3 shows sync progress and final version on success, and a recoverable error state with retry on failure.
- EngagementStatus.tsx displays the synced skill version pulled from `get_sync_status`.
- No hardcoded version strings in component code — version always comes from the IPC response.
