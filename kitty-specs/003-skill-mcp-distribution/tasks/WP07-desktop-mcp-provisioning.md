---
work_package_id: WP07
title: Desktop MCP Provisioning
lane: planned
dependencies: []
subtasks:
- T039
- T040
- T041
- T042
- T043
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

# Work Package Prompt: WP07 - Desktop MCP Provisioning

## Objective

Add an MCP registry module to the joyus-desktop companion that automatically provisions, registers, and manages local MCP servers (axe-core, lighthouse, screenshot, etc.) so they appear in Claude Code without any user configuration.

## Context

The joyus-desktop companion is an Electron app. Local MCP servers from `zivtech-mcp-tools` use stdio transport — they run as child Node.js processes with stdin/stdout communication. The companion needs to: install the MCP server packages (post-WP06 fixes), register them in Claude Code's `.mcp.json`, manage their lifecycle (start/stop), and integrate with the existing `packages/updater` for version management. Browser-dependent MCPs (axe-core, lighthouse, screenshot) need Puppeteer/Playwright as a runtime dependency.

**Requirements**: FR-009, FR-010, FR-011, FR-014, NFR-003 (<5 min install)

## Subtasks

### T039: Add MCP registry module to joyus-desktop (install, configure, start, stop)

**Purpose**: Central module that manages the lifecycle of all local MCP servers (FR-009).

**Steps**:
1. Create the registry module in the joyus-desktop project:
   - `packages/mcp-registry/src/index.ts` — main registry class
   - `packages/mcp-registry/src/types.ts` — interfaces
   - `packages/mcp-registry/src/lifecycle.ts` — process management
2. Define the registry interface:
   ```typescript
   interface McpRegistry {
     registerServer(name: string, config: McpServerConfig): void;
     startServer(name: string): Promise<void>;
     stopServer(name: string): Promise<void>;
     restartServer(name: string): Promise<void>;
     getStatus(name: string): ServerStatus;
     listServers(): McpServerInfo[];
     startAll(): Promise<void>;
     stopAll(): Promise<void>;
   }

   interface McpServerConfig {
     command: string;        // "node"
     args: string[];         // ["/path/to/dist/index.js"]
     env?: Record<string, string>;
     healthCheck?: () => Promise<boolean>;
   }
   ```
3. Registry maintains a manifest of available MCP servers:
   ```json
   {
     "servers": {
       "axe-core": { "command": "node", "args": ["..."], "enabled": true },
       "lighthouse": { "command": "node", "args": ["..."], "enabled": true },
       "screenshot": { "command": "node", "args": ["..."], "enabled": true },
       "readability": { "command": "node", "args": ["..."], "enabled": true },
       "eval-runner": { "command": "node", "args": ["..."], "enabled": true }
     }
   }
   ```
4. On companion start: read manifest, call `startAll()` for enabled servers.
5. On companion quit: call `stopAll()` for graceful shutdown.
6. Expose registry state via IPC for the renderer process (system tray status).

**Files**: `packages/mcp-registry/src/index.ts`, `packages/mcp-registry/src/types.ts`, `packages/mcp-registry/src/lifecycle.ts`, `packages/mcp-registry/src/manifest.ts`

**Validation**: Registry can register, start, stop, and list MCP servers. Servers start on companion launch and stop on companion quit. Status is queryable.

---

### T040: Auto-register local MCPs in Claude Code `.mcp.json` on companion start

**Purpose**: When desktop companion starts, Claude Code automatically sees the local MCP servers (FR-010).

**Steps**:
1. Locate Claude Code's MCP configuration file:
   - User-level: `~/.claude/.mcp.json`
   - Or project-level: `.mcp.json` in project root
   - Prefer user-level for global availability
2. On companion start, merge managed entries into `.mcp.json`:
   ```json
   {
     "mcpServers": {
       "zivtech-axe-core": {
         "command": "node",
         "args": ["/path/to/axe-core/dist/index.js"],
         "_managed_by": "joyus-desktop",
         "_version": "1.0.0"
       },
       "zivtech-lighthouse": { ... },
       "zivtech-screenshot": { ... }
     }
   }
   ```
3. Merge strategy:
   - Read existing `.mcp.json` (parse JSON, handle malformed gracefully)
   - Add/update entries with `_managed_by: "joyus-desktop"` marker
   - Preserve all entries WITHOUT the marker (user's own MCP configs)
   - Write back the merged result
4. On companion stop (optional):
   - Remove managed entries, or leave them (they'll fail gracefully if server isn't running)
   - Leaving them is simpler — Claude Code handles unavailable MCPs
5. Use `_managed_by` marker to identify entries safe to update/remove on next companion start.

**Files**: `packages/mcp-registry/src/claude-code-integration.ts`

**Validation**: After companion start, Claude Code shows managed MCP tools (e.g., `mcp__zivtech-axe-core__*`). Existing user MCP entries untouched. Malformed `.mcp.json` handled without crash.

---

### T041: Integrate with `packages/updater` for version checks

**Purpose**: MCP server packages should be kept up-to-date through the existing updater infrastructure (FR-011).

**Steps**:
1. Review existing `packages/updater` module:
   - How does it check for updates? (GitHub releases, custom endpoint, etc.)
   - How does it apply updates? (Download + replace, auto-restart, etc.)
   - What's the manifest format?
2. Extend the updater to track MCP server versions:
   - Add MCP packages to the updater's manifest (name, current version, source)
   - Check for new versions on the same schedule as app updates
3. Update flow:
   - New version detected → download new package
   - Stop the running MCP server
   - Replace binary/dist files
   - Start the new version
   - Update manifest with new version
4. Rollback on failure:
   - Keep previous version in a backup location
   - If new version fails to start (exit code != 0 within 5s), restore backup
   - Log the failure for debugging
5. Log version transitions in the registry manifest.

**Files**: `packages/mcp-registry/src/updater-integration.ts`, updates to `packages/updater/`

**Validation**: Updater detects new MCP server version available. Update applies: stop → replace → start. Failed update rolls back to previous version.

---

### T042: Ensure clean start/stop (no orphaned Node processes)

**Purpose**: MCP servers run as child Node processes — must not leak processes on companion crash or quit.

**Steps**:
1. Track all spawned child process PIDs in the registry:
   ```typescript
   private processes: Map<string, ChildProcess> = new Map();
   ```
2. Graceful shutdown sequence:
   - Send `SIGTERM` to each child process
   - Wait up to 5 seconds for exit
   - If still running, send `SIGKILL`
   - Remove from tracking map
3. Crash recovery via PID file:
   - On start: write all managed PIDs to `~/.joyus-desktop/mcp-pids.json`
   - On startup: check if PID file exists from previous run
   - For each stale PID: check if process is still running (`kill -0 <pid>`)
   - Kill any orphaned processes from previous run
   - Clean up PID file
4. Watchdog (optional but recommended):
   - Every 30 seconds, check if managed processes are still running
   - If a process died unexpectedly: restart it, log the crash
   - Max 3 auto-restarts before giving up (prevent restart loops)
5. Test scenarios:
   - Normal quit → all processes stopped
   - Force-kill companion (`kill -9`) → restart → orphans cleaned up
   - MCP server crash → watchdog restarts it

**Files**: `packages/mcp-registry/src/process-manager.ts`

**Validation**: Normal quit: zero orphaned processes. Force-kill: orphans cleaned on restart. Watchdog restarts crashed servers. PID file accurately tracks state.

---

### T043: Verify local MCP tools respond to calls in Claude Code

**Purpose**: End-to-end verification that desktop-provisioned MCP servers work from Claude Code.

**Steps**:
1. Start desktop companion — confirm it logs server startup.
2. Open Claude Code in a new terminal session.
3. Verify MCP servers appear in available tools:
   - Check for `mcp__zivtech-axe-core__*` tools
   - Check for `mcp__zivtech-lighthouse__*` tools
   - Check for `mcp__zivtech-screenshot__*` tools
4. Make a tool call to each available MCP server:
   - axe-core: Run accessibility scan on a test URL
   - lighthouse: Generate performance report for a test URL
   - screenshot: Capture screenshot of a test URL
   - readability: Analyze text readability of a test page
5. Verify each response contains real data (not errors or empty results).
6. Stop desktop companion → verify tools are gracefully unavailable in Claude Code (error, not crash).
7. Restart companion → verify tools work again.
8. Document all results.

**Files**: `docs/verification/wp07-mcp-provisioning-verification.md`

**Validation**: All provisioned MCP tools respond correctly. Start/stop lifecycle works cleanly. Results documented with evidence.

## Implementation Notes

- **Electron integration**: The MCP registry runs in the Electron main process. Use `child_process.spawn()` for MCP servers. Hook into Electron's `app.on('before-quit')` for graceful shutdown.
- **stdio transport**: MCP servers communicate via stdin/stdout. The companion spawns them; Claude Code connects to them via the `.mcp.json` configuration pointing to the same command/args.
- **`.mcp.json` merge**: Use JSON parsing (not string manipulation). Handle edge cases: file doesn't exist (create), file is empty (initialize), file has syntax errors (backup and recreate).
- **Browser dependencies**: axe-core, lighthouse, screenshot need Puppeteer/Chromium. Handle as a one-time setup during companion install — download Chromium to a managed location.
- **NFR-003**: The entire companion install (including MCP provisioning) must complete in <5 minutes. MCP server downloads + Chromium download are the biggest time factors.

## Done Criteria

- [ ] MCP registry module manages server lifecycle (T039)
- [ ] Local MCPs auto-registered in Claude Code `.mcp.json` (T040)
- [ ] Updater checks for and applies MCP server updates (T041)
- [ ] No orphaned processes on crash or quit (T042)
- [ ] MCP tools verified working in Claude Code E2E (T043)

## Risks & Edge Cases

- **`.mcp.json` format changes**: Claude Code may change the config format — use documented format, version-check
- **Orphaned processes**: PID file recovery handles companion crashes
- **User edits `.mcp.json`**: Marker-based management distinguishes managed vs user entries
- **Multiple Claude Code sessions**: `.mcp.json` changes may not be picked up until session restart — document this
- **Chromium download**: May fail on restricted networks — provide offline install option
- **Port conflicts**: Shouldn't happen with stdio transport, but verify no TCP is used
- **Electron memory**: Tracking many child processes — ensure no memory leaks in the process map

## Implementation Command

```bash
spec-kitty implement WP07 --base WP06
```

## Activity Log

- 2026-03-10: Prompt generated in planned lane.
