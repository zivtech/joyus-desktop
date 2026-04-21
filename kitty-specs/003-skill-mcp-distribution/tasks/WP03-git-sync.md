---
work_package_id: WP03
title: Git Sync for CLI Developers
dependencies: []
subtasks:
- T013
- T014
- T015
- T016
- T017
- T018
- T065
phase: Phase 1 - Cowork Distribution
history:
- timestamp: '2026-03-10T00:00:00Z'
  lane: planned
  agent: ''
  action: Prompt generated
authoritative_surface: ''
execution_mode: code_change
mission_id: 01KPR4E967F61H0B7K24440QG1
owned_files:
- docs/developer-guides/skill-sync-setup.md
- docs/verification/wp03-developer-testing.md
- src/__tests__/metadata.test.ts
- src/__tests__/sync.test.ts
- src/metadata.ts
- src/sync.ts
wp_code: WP03
---

# Work Package Prompt: WP03 - Git Sync for CLI Developers

## Objective

Build a transparent git-based sync mechanism that keeps Claude Code CLI users' skills current with the admin-pinned version of `zivtech-meta-skills`, requiring zero manual git commands from the developer.

## Context

CLI developers need the full-power skills from `zivtech-meta-skills` in their `~/.claude/` directory. The sync mechanism runs as a Claude Code session hook on startup, checks the pinned version, and updates if needed. Must complete in <10s on warm cache (NFR-002) and fail gracefully offline (FR-006). The version pin is managed by admin (WP04 handles the pin mechanism — this WP reads it).

**Source**: `zivtech-meta-skills` git repo
**Target**: `~/.claude/` skills directory
**Requirements**: FR-005, FR-006, NFR-002, SC-003

## Subtasks

### T013: Build sync script that clones/pulls zivtech-meta-skills at pinned tag

**Purpose**: Core sync logic that fetches skills from the source repo at the admin-specified version.

**Steps**:
1. Create a sync module (shell script or Node.js — prefer Node for cross-platform and error handling):
   - `packages/skill-sync/src/sync.ts` (if Node)
   - Or `scripts/skill-sync.sh` (if shell)
2. Accept configuration parameters:
   - `repoUrl`: URL of `zivtech-meta-skills` repo
   - `targetVersion`: Git tag to sync to (e.g., `v1.0.0`)
   - `destDir`: Destination directory (default: `~/.claude/skills/`)
   - `cacheDir`: Where to keep the git clone (e.g., `~/.claude/.skill-sync-cache/`)
3. On first run (no cache):
   - Shallow clone at specified tag: `git clone --depth 1 --branch <tag> <repo> <cacheDir>`
   - Copy skill files from cache to destination directory
4. On subsequent runs:
   - Read current cached version from `.sync-metadata.json`
   - If pinned version matches cached: skip (no-op, fast path)
   - If pinned version differs: `git fetch --depth 1 origin tag <newTag>` then `git checkout <newTag>`
   - Copy updated skill files to destination
5. Write `.sync-metadata.json` after every sync:
   ```json
   {
     "lastSync": "2026-03-10T12:00:00Z",
     "version": "v1.0.0",
     "status": "success",
     "repoUrl": "...",
     "filesUpdated": 29
   }
   ```

**Files**: `packages/skill-sync/src/sync.ts`, `packages/skill-sync/src/metadata.ts`

**Validation**: Script clones repo at specified tag on first run. Subsequent run with same tag is a no-op (<1s). Run with different tag updates to new version. `.sync-metadata.json` reflects current state.

---

### T014: Integrate as Claude Code session hook (startup trigger, <10s)

**Purpose**: Sync runs automatically when developer starts Claude Code — no manual step needed (NFR-002).

**Steps**:
1. Research Claude Code's hook system for session start hooks:
   - Check `~/.claude/hooks.json` or equivalent configuration
   - Identify the right hook event (e.g., `session_start`, `pre_tool_use`)
2. Create hook configuration that calls the sync script:
   ```json
   {
     "hooks": {
       "session_start": {
         "command": "node /path/to/skill-sync/dist/index.js",
         "timeout_ms": 10000,
         "async": true
       }
     }
   }
   ```
3. Ensure hook runs async/non-blocking — don't delay session start.
4. If sync takes >10s, the timeout should kill the sync process; cached version is used.
5. Add the hook configuration to the developer setup process (from T017).

**Files**: Hook configuration in `~/.claude/hooks.json` or equivalent

**Validation**: Starting a Claude Code session triggers sync automatically. Sync completes in <10s on warm cache (measured). Session is not blocked if sync is slow.

---

### T015: Handle offline gracefully (last good state, no error surfaced)

**Purpose**: Network unavailability must not break the developer experience (FR-006).

**Steps**:
1. In the sync script, wrap all git network operations in try/catch:
   - `git clone` failure → log warning, exit cleanly
   - `git fetch` failure → log warning, exit cleanly
   - DNS resolution failure → same
   - Timeout → same
2. When network fails:
   - Log to `.sync-metadata.json`: `"status": "offline", "lastAttempt": "...", "lastSuccess": "..."`
   - Do NOT surface any error to the user (no stderr output, no non-zero exit code)
   - Preserve existing cached skills in place — user continues with last good version
3. On next successful sync, update metadata and resume normal operation.
4. Add a `--status` flag for debugging: `skill-sync --status` prints current sync state.

**Files**: Error handling in sync script from T013

**Validation**: Disconnect network → start Claude Code → skills still available from last sync → no error messages shown to user. Reconnect → next session syncs successfully. `--status` shows accurate state.

---

### T016: Handle local modification conflicts (overwrite + warn)

**Purpose**: If a developer manually edits a synced skill file, sync should recover cleanly.

**Steps**:
1. Before copying files from cache to destination, check for local modifications:
   - Compare checksums of destination files against cached originals
   - Or check git status in the cache directory
2. If modifications found:
   - Log a warning with the list of modified files to `.sync-metadata.json`
   - Back up modified files to `~/.claude/.skill-sync-backups/<timestamp>/`
   - Force copy the pinned version to destination (overwrite local changes)
3. Keep at most 5 backup directories (prune oldest on new backup).
4. Log message: "Warning: Local modifications to X skills were overwritten. Backups saved to ~/.claude/.skill-sync-backups/..."

**Files**: Conflict handling in sync script from T013

**Validation**: Manually edit a synced skill → run sync → skill reverts to pinned version. Warning logged to metadata. Backup of modified file exists in backups directory.

---

### T017: Document one-time developer setup

**Purpose**: Create a developer-facing setup guide that takes <5 minutes to complete.

**Steps**:
1. Write setup guide covering:
   - **Prerequisites**: git, Node.js (if Node-based sync), Claude Code installed, access to `zivtech-meta-skills` repo (SSH key or token)
   - **One-time setup steps**:
     1. Install the sync module (npm package, or copy script)
     2. Configure repo URL and auth (environment variable or config file)
     3. Register the Claude Code session hook
     4. Run initial sync manually to verify: `skill-sync --sync`
     5. Verify skills appear in Claude Code
   - **Verification**: How to check sync is working (`skill-sync --status`)
   - **Troubleshooting**: Common issues (auth failures, network, version mismatch)
2. Keep guide concise — target <2 pages.
3. Include a "Quick Start" section (3 commands) for experienced developers.

**Files**: `docs/developer-guides/skill-sync-setup.md`

**Validation**: A new developer can follow the guide end-to-end in <5 minutes and have working skill sync.

---

### T018: Verify with 2 developer testers (SC-003)

**Purpose**: Real-world validation that sync works for actual developers.

**Steps**:
1. Identify 2 developer testers (different machines/environments if possible).
2. Provide each with the setup guide from T017.
3. Have each follow the guide independently — no hand-holding.
4. Verification checklist per tester:
   - [ ] Setup completed without guide errors
   - [ ] Initial sync pulled correct version
   - [ ] Skills appear in Claude Code session
   - [ ] Invoking a skill works correctly
   - [ ] New session triggers auto-sync (check metadata timestamp)
   - [ ] Offline: skills still work, no errors
5. Collect feedback: what was confusing, what could be better, any bugs found.
6. Fix any issues and update the setup guide accordingly.

**Files**: `docs/verification/wp03-developer-testing.md`

**Validation**: 2 developers confirmed working sync. All checklist items pass. Setup guide updated with feedback.

### T065: Unit and integration tests for sync module (Constitution 2.5)

**Purpose**: Achieve 100% coverage on the sync module per constitution mandate (2.5 Full Coverage Gates).

**Steps**:
1. Create test file: `packages/skill-sync/src/__tests__/sync.test.ts`
2. Unit tests for core sync logic:
   - First-run clone path (no cache exists)
   - Subsequent run with same version (no-op fast path)
   - Version change triggers update
   - Metadata file written correctly after sync
3. Unit tests for error handling:
   - Network failure → graceful offline (no throw, cached version preserved)
   - Malformed metadata file → recreated
   - Invalid tag → clear error message
4. Unit tests for conflict handling:
   - Local modifications detected → backed up and overwritten
   - Backup directory pruning (keep max 5)
5. Integration test: full sync cycle (clone → update → offline → recover)
6. Verify: 100% lines/functions/branches/statements coverage.

**Files**: `packages/skill-sync/src/__tests__/sync.test.ts`, `packages/skill-sync/src/__tests__/metadata.test.ts`

**Validation**: `npm test -- --coverage` shows 100% across all metrics. All edge cases covered.

---

## Implementation Notes

- **Keep it simple**: The sync script should be a small, focused module. Avoid heavy dependencies. Shell script or a single Node file is ideal.
- **Version pin source**: For this WP, the pin can come from a simple config file or environment variable. WP04 formalizes the pin mechanism — this WP just needs to READ a pinned version string.
- **Speed**: Shallow clones (`--depth 1`) are critical for the <10s requirement. Full git history is unnecessary for distribution.
- **Consider `git archive`**: For even faster downloads, GitHub API's tarball endpoint or `git archive` may outperform `git clone` — evaluate during implementation.
- **Cross-platform**: If using shell script, ensure it works on macOS and Linux. Windows developers likely use WSL.

## Done Criteria

- [ ] Sync script clones/updates skills at pinned tag (T013)
- [ ] Integrated as Claude Code session hook, <10s on warm cache (T014)
- [ ] Offline: uses last good version, no user-facing errors (T015)
- [ ] Local conflicts: overwritten with warning and backup (T016)
- [ ] Developer setup guide complete and tested (T017)
- [ ] Verified by 2 developer testers (T018)
- [ ] 100% test coverage on sync module (T065) — constitution 2.5 mandatory

## Risks & Edge Cases

- **Git remote unreachable** (firewall, VPN): Sync must not block session — handled by T015
- **Shallow clone limitations**: Can't inspect full history — acceptable for distribution
- **Large skill repo**: If repo grows large, consider sparse checkout for relevant bundle only
- **Race condition**: Multiple Claude Code sessions starting simultaneously — use file locking on `.sync-metadata.json`
- **Windows/WSL**: Ensure script works cross-platform or document platform requirements
- **Auth token expiry**: Git credentials may expire — document re-auth in troubleshooting guide

## Implementation Command

```bash
spec-kitty implement WP03 --base WP01
```

## Activity Log

- 2026-03-10: Prompt generated in planned lane.
- 2026-03-11T00:33:18Z – codex – shell_pid=17250 – lane=doing – Started WP03 implementation
- 2026-03-12T01:59:47Z – codex – shell_pid=17250 – lane=for_review – Ready: skill-sync package (5 modules, 46 tests), hook integration, developer setup guide, tester checklist.
- 2026-03-12T02:05:17Z – codex – shell_pid=17250 – lane=done – Review passed: 46 tests, clean architecture, all deliverables. Hardcoded paths noted for fix before SC-003 tester verification.
