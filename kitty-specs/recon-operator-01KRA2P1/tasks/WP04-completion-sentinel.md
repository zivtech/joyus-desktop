---
work_package_id: WP04
title: Completion Sentinel
dependencies: []
requirement_refs:
- FR-005
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts for this feature were generated on main. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into main unless the human explicitly redirects the landing branch.
subtasks:
- T016
- T017
agent: "claude:opus:implementer:implementer"
shell_pid: "80745"
history:
- date: '2026-05-10'
  event: created
  note: Generated via /spec-kitty.tasks
authoritative_surface: kitty-specs/recon-operator-01KRA2P1/tasks/WP04-completion-sentinel.md
execution_mode: planning_artifact
mission_id: 01KRA2P11PNXGNMMJQYQYP34M8
owned_files:
- kitty-specs/recon-operator-01KRA2P1/tasks/WP04-completion-sentinel.md
tags: []
wp_code: WP04
---

# WP04: Completion Sentinel

## Overview

Extend the deployed Joyus Recon skill to write a `.recon-complete` JSON sentinel file when a session finishes. This file is the backup metadata source that Desktop's `get_engagement_status` command reads after process exit. The primary completion signal is the process exit code — the sentinel is supplementary but required for structured status reporting.

## Execution Mode: Manual

This WP requires editing a deployed skill file at `~/.claude/skills/joyus-recon.md`. It cannot be tested in CI. Verification requires running the Recon skill in `-p` mode and confirming sentinel output.

## Sentinel File Contract

**Location**: `{engagementDir}/.recon-complete`

**On success**:
```json
{
  "status": "success",
  "timestamp": "2026-05-10T14:23:45.123Z",
  "phases_completed": 4,
  "output_files": ["ARD.md", "competitive-analysis.md", "recon-summary.md"]
}
```

**On fatal error**:
```json
{
  "status": "error",
  "timestamp": "2026-05-10T14:23:45.123Z",
  "error": "Phase 2 failed: CrUX API returned 429",
  "last_phase_completed": 1
}
```

**Rules**:
- Written as the LAST action before session ends — after all output files are written.
- Both success and fatal-error paths must produce the sentinel.
- Partial runs (user cancellation via `cancel_engagement`) do NOT need to write the sentinel — Desktop detects the missing sentinel after a non-zero exit and marks the status as `"complete (no metadata)"`.
- The file must be valid JSON. Desktop parses it without a try/catch safety net in the MVP.

## Subtasks

### T016 — Add completion signaling section to `~/.claude/skills/joyus-recon.md`

Locate the end of the "Customization Points" section (approximately line 1415, but verify the actual line before editing).

Append the following section **after** the "Customization Points" section and **before** any subsequent sections:

```markdown
## Completion Signaling (Desktop Integration)

After ALL phases complete — whether success or partial failure — write a JSON sentinel
file `.recon-complete` to the engagement root directory. This is the LAST action before
the session ends.

**On success** (all planned phases completed):
```json
{
  "status": "success",
  "timestamp": "<ISO-8601 UTC>",
  "phases_completed": <N>,
  "output_files": ["<file1>", "<file2>", ...]
}
```

**On fatal error** (session cannot continue):
```json
{
  "status": "error",
  "timestamp": "<ISO-8601 UTC>",
  "error": "<human-readable description>",
  "last_phase_completed": <N>
}
```

The sentinel is BACKUP metadata. Desktop's primary completion signal is process exit
(exit code 0 = success). If the sentinel is absent after a clean exit, Desktop marks
the engagement "complete (no metadata)" — it does not block the operator.

Write the sentinel using the `Write` tool, not `Bash`, to ensure it is flushed before
the session ends.
```

**Implementation note for the skill**: The sentinel write should use the `Write` tool targeting `{engagementDir}/.recon-complete`. The engagement directory is established in Phase 0 and should be tracked as a session variable throughout.

### T017 — Add Phase 0 prerequisite check for engagement directory

Locate the Phase 0 prerequisites section in `~/.claude/skills/joyus-recon.md`.

Add the following check at the end of the Phase 0 prerequisites list:

```
- Verify the engagement directory exists and contains the expected template files
  before beginning Phase 1. Expected files include at minimum the ARD template.
  If the directory is absent or empty, inform the operator:
  "The engagement directory appears uninitialized. The Desktop app should run
  init-engagement.mjs before launching a Recon session. Please cancel and retry
  from the Desktop interface."
  Do NOT attempt to create the directory or templates manually — that is the
  Desktop's responsibility via the recon.create sidecar handler.
```

## Verification

Manual verification steps (document results in a checklist comment on the PR or in the WP review):

1. Run Recon in `-p` mode for a test engagement with a real or stub engagement directory.
2. Confirm `.recon-complete` appears in the engagement directory after the session exits.
3. Confirm the JSON is parseable: `node -e "JSON.parse(require('fs').readFileSync('.recon-complete', 'utf8'))"`.
4. Intentionally cause a Phase 2 failure (e.g., invalid API key). Confirm an error-format sentinel is written with `"status": "error"` and a non-null `last_phase_completed`.
5. Confirm `get_engagement_status` (WP03 T013) correctly reads and surfaces sentinel data.

## Success Criteria

- Running Recon in `-p` mode with a valid engagement dir produces `.recon-complete` in that directory.
- Both success and error paths produce a sentinel before the session exits.
- The sentinel JSON matches the documented schema (both required fields present, timestamp is ISO-8601, no extra top-level keys that would break the Desktop parser).
- Phase 0 includes a check for the engagement directory and surfaces a clear operator-facing message if it is absent.

## Activity Log

- 2026-05-10T23:50:30Z – claude:opus:implementer:implementer – shell_pid=80745 – Started implementation via action command
