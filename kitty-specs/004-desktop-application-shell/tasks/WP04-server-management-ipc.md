---
work_package_id: WP04
title: Server Management IPC
dependencies: []
subtasks: [T017, T018, T019, T020]
history:
- date: '2026-03-14'
  event: created
  note: Generated from spec-kitty.tasks
authoritative_surface: ''
execution_mode: code_change
mission_id: 01KPR4E967F61H0B7K24440QG2
owned_files:
- src/sidecar/chrome-detect.ts
- src/sidecar/services.ts
- test/sidecar/server-management.test.ts
wp_code: WP04
---

# WP04 — Server Management IPC

**Objective**: Implement the sidecar IPC methods for MCP server management (list, start, stop, restart), health checks, Chrome detection, and server state change notifications.

**Implementation command**: `spec-kitty implement WP04 --base WP03`

## Context

The mcp-registry package already provides `createProcessManager` and `createRegistry` with full server lifecycle management. This WP wires those into the sidecar's JSON-RPC handler so the Rust backend (and ultimately the dashboard) can manage servers.

Refer to `contracts/sidecar-ipc.md` for the full request/response shapes.

---

## Subtask T017: Implement Server Management Methods

**Purpose**: Expose server CRUD operations via JSON-RPC.

**Steps**:
1. In `services.ts`, ensure the registry is initialized with a manifest (from config or auto-discovered)
2. Register IPC handlers in the method registry:
   - `servers.list`: call `registry.listServers()`, return `ServerInfo[]`
   - `servers.start`: call `registry.startServer(name)`, return `ServerInfo`
   - `servers.stop`: call `registry.stopServer(name)`, return `{ stopped: boolean }`
   - `servers.restart`: call `registry.restartServer(name)`, return `ServerInfo`
3. Map registry types to the IPC contract types (they should already align since both use `McpServerInfo`)
4. Handle errors: server not registered, already running, etc. Return JSON-RPC error with descriptive message

**Files**:
- Update `apps/desktop-companion/src/sidecar/services.ts` (~60 lines)

**Validation**:
- [ ] `servers.list` returns all registered servers with correct status
- [ ] `servers.start` spawns a server and returns updated info
- [ ] `servers.stop` terminates a server
- [ ] `servers.restart` stop+starts a server
- [ ] Errors for invalid server names return -32602

---

## Subtask T018: Implement Server State Notifications

**Purpose**: Push real-time server status changes to the Rust backend as JSON-RPC notifications.

**Steps**:
1. Hook into the processManager's watchdog events:
   - When a server crashes and is restarted by the watchdog → emit `state.serverChanged` with new status
   - When a server exceeds max restarts → emit `state.serverChanged` with status "error"
   - When a server is manually started/stopped → emit `state.serverChanged`
2. Use the `sendNotification` function from ipc-handler.ts
3. Notification payload matches the `state.serverChanged` contract:
   ```json
   { "name": "axe-core", "status": "error", "lastError": "...", "restartCount": 5 }
   ```

**Files**:
- Update `apps/desktop-companion/src/sidecar/services.ts` (~40 lines)

**Validation**:
- [ ] Server crash triggers a `state.serverChanged` notification on stdout
- [ ] Manual start/stop triggers notifications
- [ ] Notification payload matches contract schema

---

## Subtask T019: Implement Health Check & Chrome Detection

**Purpose**: Provide diagnostic endpoints for the Rust backend.

**Steps**:
1. `health.check`: return `{ ok: true, uptime_ms: Date.now() - startTime }`
2. `chrome.detect`:
   - Check common Chrome paths per platform:
     - macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
     - Windows: `C:\Program Files\Google\Chrome\Application\chrome.exe` and `C:\Program Files (x86)\...`
   - If found, get version via `chrome --version`
   - Return `{ available: boolean, path?: string, version?: string }`
3. Register both in the method registry

**Files**:
- Create `apps/desktop-companion/src/sidecar/chrome-detect.ts` (new, ~40 lines)
- Update `apps/desktop-companion/src/sidecar/services.ts` (~15 lines)

**Validation**:
- [ ] `health.check` returns ok with uptime
- [ ] `chrome.detect` finds Chrome when installed
- [ ] `chrome.detect` returns `{ available: false }` when Chrome is not found

---

## Subtask T020: Tests for Server Management IPC

**Purpose**: 100% test coverage for all server management methods.

**Steps**:
1. Create `apps/desktop-companion/test/sidecar/server-management.test.ts`:
   - Test `servers.list` returns correct format
   - Test `servers.start` with valid and invalid server names
   - Test `servers.stop` with running and stopped servers
   - Test `servers.restart` round-trip
   - Test `state.serverChanged` notification emission on crash
   - Test `health.check` returns ok
   - Test `chrome.detect` with mocked file system
2. Use dependency injection: mock processManager, mock registry
3. Verify notification output on stdout mock

**Files**:
- `apps/desktop-companion/test/sidecar/server-management.test.ts` (new, ~150 lines)

**Validation**:
- [ ] All tests pass
- [ ] 100% branch coverage on server management IPC code

---

## Definition of Done

- [ ] All 4 server methods respond correctly via JSON-RPC
- [ ] Server state change notifications are emitted
- [ ] Health check and Chrome detection work
- [ ] 100% test coverage
- [ ] `pnpm typecheck` passes

## Activity Log

- 2026-03-14T22:51:48Z – agent-wp04 – shell_pid=66406 – lane=doing – Started implementation via workflow command
- 2026-03-14T23:13:16Z – agent-wp04 – shell_pid=66406 – lane=done – Complete
