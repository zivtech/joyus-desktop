---
work_package_id: WP10
title: Version Consistency Gate
dependencies:
- WP09
requirement_refs:
- FR-013
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts for this feature were generated on main. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into main unless the human explicitly redirects the landing branch.
subtasks:
- T040
- T041
- T042
history:
- date: '2026-05-10'
  event: created
  note: Generated via /spec-kitty.tasks
authoritative_surface: apps/desktop-companion/src/sidecar/version-gate.ts
execution_mode: code_change
mission_id: 01KRA2P11PNXGNMMJQYQYP34M8
owned_files:
- apps/desktop-companion/src/sidecar/version-gate.ts
tags: []
wp_code: WP10
---

# WP10: Version Consistency Gate

## Overview

Prevent recon engagements from launching against a stale skill version by adding a pre-launch version check that auto-syncs when a mismatch is detected. Also extend the `.recon-complete` sentinel schema to carry the skill version used, giving the Desktop layer a reliable record of which version produced each engagement's output.

**Ownership note**: This WP modifies `recon.ts`, which is the authoritative surface for WP01. WP10 depends on WP09, which depends on no WP (and WP01 has no dependency on WP09 or WP10). The dependency chain ensures WP01 is merged before WP10 runs — no parallel ownership conflict. The implementer should rebase from main (which includes WP01's changes) before starting WP10.

## Codebase Pattern

Sidecar handlers in `apps/desktop-companion/src/sidecar/recon.ts`. IPC handler signature: `(params: unknown) => Promise<unknown>`. Sync status available via the `sync.*` IPC namespace (check existing sidecar files for the exact method names). The `.recon-complete` sentinel is a JSON file written by the analysis skill at the end of an engagement.

## Subtasks

### T040 — Pre-launch version check

Add a `recon.checkVersion` handler to `registerReconMethods` in `recon.ts` (or fold the logic directly into the pre-launch path of `recon.create` — document the choice with a comment).

**Behavior**:
1. Call `sync.status` (or the equivalent sync IPC method) to get the currently deployed version of `recon-operator-bundle`.
2. Read the pinned version from `distribution-config.json` (the `"version"` / `"tag"` / `"ref"` field set in WP09 T037). The config must be imported or read from the known config path — do not hardcode the version string.
3. Compare deployed version against pinned version.
4. Return `{ current: string, pinned: string, match: boolean }`.

If `sync.status` returns an error or the deployed version is `null`/`undefined`, treat as `match: false` and include a `stale: true` flag in the response.

### T041 — Auto-sync on version mismatch

Extend `recon.create` (the engagement launch handler from WP01) to run the version gate before creating the engagement directory.

**Logic**:
1. Call the version check logic from T040.
2. If `match: true`: proceed to engagement creation normally.
3. If `match: false`:
   a. Call `sync.trigger({ bundle: "recon-operator-bundle" })` and await completion.
   b. After sync completes, re-run the version check.
   c. If versions now match: proceed to engagement creation.
   d. If versions still do not match after sync: return an error — `{ error: "skill_sync_failed", message: "Could not update Recon skill to required version {pinned}. Check network connection and retry." }`. Do NOT create the engagement directory.
4. Include a `syncPerformed: boolean` field in the `recon.create` success response so the frontend can surface a "skill updated automatically" notice if desired.

Do not add a sleep or retry loop — one sync attempt is sufficient. If sync itself errors, propagate the sync error message.

### T042 — Include `skill_version` in `.recon-complete` sentinel

The `.recon-complete` sentinel is a JSON file written by the analysis skill (Claude Code session) at the end of a successful engagement. The Desktop reads this file in `get_engagement_status` to determine engagement completion.

**Schema extension** — the sentinel must include:

```json
{
  "completedAt": "<ISO-8601>",
  "skill_version": "<semver string>",
  "engagementId": "<string>"
}
```

**Desktop-side changes** (in `recon.ts` or wherever `get_engagement_status` reads the sentinel):
1. When reading `.recon-complete`, parse and include `skill_version` in the returned status object.
2. If `skill_version` is absent (sentinel written by an older skill version), return `skill_version: null` — do not error.

**Analysis-skill-side changes** (document as a requirement, do not implement here — this is a cross-repo change):
- The joyus-recon skill must write `skill_version` into `.recon-complete` from its own version constant.
- File a GitHub issue in the joyus-recon repo (or add a TODO comment referencing this WP) so the skill-side change is tracked.

## Success Criteria

- Deploying a deliberately stale version of the recon skill (by temporarily pinning an old tag in `distribution-config.json`) causes `recon.create` to auto-sync before creating the engagement directory.
- After auto-sync, the engagement launches successfully without user intervention.
- If sync fails (simulate by disabling network), `recon.create` returns a clear error and no engagement directory is created.
- `get_engagement_status` returns a `skill_version` field in its response (may be `null` for engagements completed by older skill versions).
- TypeScript compiles without errors after WP10 changes.
