# WP07 - Desktop MCP Provisioning - E2E Verification

## Overview
Verification plan for the `@joyus/mcp-registry` package which manages local MCP server lifecycle and auto-registers them in Claude Code's `.mcp.json`.

## Unit Test Coverage

### Process Manager (`processManager.ts`)
- [ ] Spawn server returns PID and tracks process
- [ ] Stop server sends SIGTERM, falls back to SIGKILL after 5s
- [ ] Stop all terminates every tracked process
- [ ] PID file write/read round-trips correctly
- [ ] Orphan cleanup kills stale PIDs and clears PID file
- [ ] Watchdog detects dead processes and invokes restart callback
- [ ] Watchdog stops restarting after max restart limit
- [ ] Duplicate spawn throws error

### Registry (`registry.ts`)
- [ ] Initialize from manifest populates server list
- [ ] Register/unregister servers dynamically
- [ ] Start/stop/restart lifecycle transitions
- [ ] getStatus reflects running/stopped/error states
- [ ] startAll starts only enabled, non-running servers
- [ ] stopAll delegates to process manager

### Claude Code Integration (`claudeCodeIntegration.ts`)
- [ ] Merge preserves non-managed entries
- [ ] Merge replaces old managed entries
- [ ] Remove strips only `_managed_by: "joyus-desktop"` entries
- [ ] Missing `.mcp.json` file creates fresh config
- [ ] Empty file initializes correctly
- [ ] Malformed JSON triggers backup and recreate

### Updater Integration (`updaterIntegration.ts`)
- [ ] Detects available updates from remote version check
- [ ] Skips servers not present in remote
- [ ] Apply update: backup, stop, replace, start sequence
- [ ] Rollback on update failure restores previous version
- [ ] Rollback handles already-stopped server gracefully

## Integration Test Steps (Manual)

1. **Install and build**: `pnpm install && pnpm typecheck`
2. **Run unit tests**: `pnpm vitest run packages/mcp-registry --coverage`
3. **Verify 100% coverage** on lines, functions, branches, statements
4. **Simulate MCP registration**:
   - Create a test `.mcp.json` with existing user entries
   - Call `writeMcpConfig` to add managed entries
   - Verify user entries are preserved
   - Call `removeMcpConfig` to clean up
   - Verify user entries remain, managed entries removed
5. **Simulate process lifecycle**:
   - Mock-spawn a server, verify PID tracking
   - Stop server, verify SIGTERM sent
   - Verify PID file updated on start/stop
   - Kill process externally, verify watchdog detects and restarts

## Acceptance Criteria
- All unit tests pass
- 100% code coverage (lines, functions, branches, statements)
- TypeScript strict mode compiles without errors
- No orphaned processes after stopAll
- `.mcp.json` user entries never corrupted by managed operations
