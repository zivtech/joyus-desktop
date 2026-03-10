---
work_package_id: WP08
title: Desktop Git Sync Integration
lane: planned
dependencies:
- WP06
- WP03
subtasks:
- T044
- T045
- T046
- T047
- T068
phase: Phase 2 - Desktop Companion
assignee: ''
agent: ''
shell_pid: ''
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-03-10T00:00:00Z'
  lane: planned
  agent: ''
  action: Prompt generated
---

# Work Package Prompt: WP08 - Desktop Git Sync Integration

## Objective

Embed the git-based skill sync mechanism (from WP03) into the joyus-desktop companion so that skills are managed transparently — the user never interacts with git, and the desktop companion handles clone, update, and version pin tracking automatically.

## Context

WP03 built a standalone sync mechanism for CLI developers. This WP integrates that same logic into the desktop companion lifecycle, so non-CLI users (or developers who prefer the companion) get skill sync without any manual setup. The companion manages the clone directory in an app-owned location, runs sync on startup and periodically, and reads the same version pin as Cowork distribution.

**Dependency**: Reuses sync logic from WP03. Requires WP06 fixes for clean MCP server builds.
**Requirements**: FR-005, FR-009

## Subtasks

### T044: Embed git sync into desktop companion lifecycle

**Purpose**: Desktop companion automatically syncs skills on startup, mirroring the CLI hook behavior.

**Steps**:
1. Import or reference the sync logic from WP03:
   - If WP03 produced a Node module (`packages/skill-sync`): import directly
   - If WP03 produced a shell script: shell out via `child_process.exec()`
   - Prefer direct import for better error handling and type safety
2. Hook into desktop companion startup:
   - In Electron main process `app.on('ready')` handler, trigger skill sync
   - Run async — do NOT block the companion UI or system tray initialization
   - Show sync status in system tray tooltip: "Skills: syncing..." → "Skills: v1.0.0 (synced)"
3. Schedule periodic re-sync:
   - Use `setInterval()` in main process: check every 6 hours while companion is running
   - On re-sync: same logic as startup sync (check pin, update if needed)
   - Interval should be configurable via companion settings (default: 6 hours)
4. Respect WP03's offline handling:
   - If network unavailable: use cached skills, show "Skills: v1.0.0 (cached, last sync: 2h ago)"
   - No error dialogs or notifications for routine sync failures
5. Log all sync activity to companion's log file for debugging.

**Files**: `packages/mcp-registry/src/skill-sync-integration.ts` or `src/main/skill-sync.ts`

**Validation**: Companion start triggers sync. Sync completes in <10s on warm cache. UI not blocked. Periodic re-sync fires at configured interval. Offline uses cached skills without errors.

---

### T045: Desktop manages clone directory transparently

**Purpose**: User never sees or interacts with the git repo — companion owns the storage location.

**Steps**:
1. Choose managed directory path:
   - macOS: `~/Library/Application Support/joyus-desktop/skill-repo/`
   - Use Electron's `app.getPath('userData')` for cross-platform compatibility
2. On first run:
   - Create the managed directory if it doesn't exist
   - Clone `zivtech-meta-skills` at the pinned tag (shallow clone)
3. On subsequent runs:
   - Fetch and update to current pinned tag
4. Copy relevant skill files from clone to Claude Code's skill directory:
   - Source: `<managed-dir>/skills/` (whatever the repo structure is)
   - Destination: `~/.claude/skills/` or `~/.claude/commands/` (wherever Claude Code expects them)
   - Use atomic copy: write to temp dir, then rename (prevents partial copies on crash)
5. Housekeeping:
   - Exclude managed directory from Spotlight: add `.metadata_never_index` file
   - Exclude from Time Machine: set `com.apple.metadata:com_apple_backup_excludeItem` extended attribute
   - Git GC periodically to prevent repo growth: `git gc --auto` every 7 days
6. On companion uninstall: clean up managed directory (document in uninstall process).

**Files**: Directory management in `packages/mcp-registry/src/skill-sync-integration.ts`

**Validation**: Clone directory created in managed location (not user-visible in Finder by default). Skills available in Claude Code after sync. User doesn't need to know git is involved. Spotlight doesn't index the repo.

---

### T046: Respect same version pin as Cowork distribution

**Purpose**: Desktop companion distributes the same skill version as Cowork — single source of truth.

**Steps**:
1. Read version pin from `distribution-config.json` (created in WP04):
   - Fetch from the repo's `main` branch HEAD (same approach as WP03/WP04)
   - Or fetch from config endpoint if one was set up
2. Pass the pinned version to the sync logic:
   - `syncSkills({ repoUrl, targetVersion: pinnedVersion, destDir: managedDir })`
3. If pin hasn't changed since last sync: skip (fast path, <1s).
4. If pin changed:
   - Fetch new tag
   - Checkout new version
   - Copy updated skills to Claude Code directory
   - Update local metadata: `{ version: "v1.1.0", syncedAt: "..." }`
5. Log version transitions for audit trail.

**Files**: Pin reading in `packages/mcp-registry/src/skill-sync-integration.ts`

**Validation**: Companion syncs to the same version Cowork distributes. Pin change detected on next sync cycle. Version metadata accurate.

---

### T047: Verify skills update when pin changes without user action

**Purpose**: End-to-end verification that pin-driven updates propagate through the desktop companion automatically.

**Steps**:
1. Start desktop companion. Confirm skills synced to `v1.0.0`:
   - Check system tray tooltip: "Skills: v1.0.0"
   - Check `~/.claude/skills/` contains expected files
   - Check sync metadata in managed directory
2. Admin updates pin to `v1.1.0` (change `distribution-config.json`, commit, push).
3. Wait for periodic re-sync (or restart companion to trigger immediate sync).
4. Verify companion detects the pin change and syncs to `v1.1.0`:
   - System tray updates: "Skills: v1.1.0"
   - `~/.claude/skills/` contains updated files
   - Metadata shows version transition
5. Open Claude Code → verify updated skills are available and functional.
6. Document the full flow with timestamps.

**Files**: `docs/verification/wp08-desktop-sync-verification.md`

**Validation**: Skills updated from v1.0.0 to v1.1.0 without any user action. Companion handled the update transparently. Claude Code reflects the new version.

### T068: Tests for desktop sync integration (Constitution 2.5)

**Purpose**: Achieve 100% coverage on sync integration code per constitution mandate.

**Steps**:
1. Create test file: `packages/mcp-registry/src/__tests__/skill-sync-integration.test.ts`
2. Unit tests:
   - Startup sync triggers on `app.ready`
   - Periodic re-sync scheduled at configured interval
   - Offline handling: uses cached, no errors surfaced
   - Managed directory creation and cleanup
   - Atomic file copy (temp dir → rename)
   - Pin reading and version comparison
3. Verify: 100% coverage on skill-sync-integration module.

**Files**: `packages/mcp-registry/src/__tests__/skill-sync-integration.test.ts`

**Validation**: 100% coverage on desktop sync integration code. Offline and error paths covered.

---

## Implementation Notes

- **Reuse WP03 logic**: Extract WP03's sync script into a shared module that both the CLI hook and desktop companion import. Don't reimplement.
- **Managed directory**: `app.getPath('userData')` returns `~/Library/Application Support/joyus-desktop/` on macOS — standard Electron convention.
- **Atomic file operations**: When copying skills to `~/.claude/`, use temp directory + rename to prevent partial copies if the process is interrupted.
- **Git in Electron**: Use `child_process` (not a JS git library) for git operations. Ensure they don't block the event loop — use `execFile` with callbacks or promisified.
- **Sync interval**: 6 hours is a sensible default. Admin-controlled pin changes don't need instant propagation — next sync cycle is fine.

## Done Criteria

- [ ] Skill sync runs automatically on companion startup (T044)
- [ ] Clone directory managed transparently in app data location (T045)
- [ ] Version pin from distribution-config.json respected (T046)
- [ ] Pin changes propagate without user action (T047, verified)
- [ ] 100% test coverage on sync integration code (T068) — constitution 2.5 mandatory

## Risks & Edge Cases

- **macOS permissions**: Companion needs write access to `~/Library/Application Support/` — standard for signed apps
- **Git operations blocking event loop**: Use async child_process — never synchronous
- **First-time sync on slow connection**: May exceed 10s — complete in background, show progress in system tray
- **Antivirus/firewall**: May block git operations — same offline handling as WP03
- **Disk space**: Shallow clone is small (~10MB), but monitor over time with gc
- **Concurrent sync**: If periodic sync fires while startup sync is still running — use a mutex/lock

## Implementation Command

```bash
spec-kitty implement WP08 --base WP06
```

## Activity Log

- 2026-03-10: Prompt generated in planned lane.
