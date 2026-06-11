---
work_package_id: WP03
title: Rust Sidecar Lifecycle & Event Bridge
dependencies: []
subtasks: [T012, T013, T014, T015, T016]
history:
- date: '2026-03-14'
  event: created
  note: Generated from spec-kitty.tasks
authoritative_surface: src/
execution_mode: code_change
mission_id: 01KPR4E967F61H0B7K24440QG2
owned_files:
- src/commands.rs
- src/main.rs
- src/sidecar.rs
wp_code: WP03
---

# WP03 — Rust Sidecar Lifecycle & Event Bridge

**Objective**: Implement the Rust-side sidecar process management (spawn, monitor, shutdown), the event bridge that converts sidecar notifications into Tauri events, and the Tauri command layer that proxies frontend requests to the sidecar.

**Implementation command**: `spec-kitty implement WP03 --base WP02`

## Context

The Rust backend is the bridge between the React frontend (webview) and the Node.js sidecar. It spawns the sidecar on app startup, sends JSON-RPC requests when the frontend invokes Tauri commands, converts sidecar notifications into Tauri events the frontend can listen to, and handles graceful shutdown.

---

## Subtask T012: Implement Sidecar Spawn and Monitoring

**Purpose**: Launch the Node.js sidecar as a child process and monitor its health.

**Steps**:
1. Create `apps/desktop-companion/src-tauri/src/sidecar.rs`:
   - `spawn_sidecar(app: &AppHandle) -> Result<Child>`: spawn the sidecar using Tauri's shell plugin `Command::new_sidecar("node")`
   - Pass the bundled sidecar script path as argument
   - Capture stdin (for sending requests) and stdout (for reading responses)
   - Redirect stderr to app log
   - Store the child process handle in app state (`Mutex<Option<Child>>`)
2. Start a background task that reads stdout line-by-line:
   - Parse each line as JSON-RPC
   - If it has an `id`: match to pending request, resolve the future
   - If no `id`: it's a notification, emit as Tauri event
3. Implement request/response correlation:
   - Maintain a `HashMap<u64, oneshot::Sender<Value>>` for pending requests
   - `send_request(method, params) -> Result<Value>`: write to stdin, await response

**Files**:
- `apps/desktop-companion/src-tauri/src/sidecar.rs` (new, ~150 lines)

**Validation**:
- [ ] Sidecar spawns on app startup
- [ ] Requests sent via stdin receive correlated responses
- [ ] Sidecar stderr appears in app logs

---

## Subtask T013: Implement Graceful Shutdown

**Purpose**: Clean shutdown of the sidecar process on app quit, with forceful fallback.

**Steps**:
1. Add `shutdown_sidecar()` to `sidecar.rs`:
   - Send SIGTERM to the child process
   - Wait up to 5 seconds for exit
   - If still alive, send SIGKILL
   - On Windows, use `TerminateProcess` (Tauri handles this via `child.kill()`)
2. Register shutdown handler in Tauri's `on_window_event` for `CloseRequested`
3. Also register `RunEvent::Exit` handler for system-level quit

**Files**:
- Update `apps/desktop-companion/src-tauri/src/sidecar.rs` (~30 lines)
- Update `apps/desktop-companion/src-tauri/src/main.rs` (register handlers)

**Validation**:
- [ ] Quitting the app stops the sidecar within 5 seconds
- [ ] No orphaned Node.js processes after quit
- [ ] Works on both macOS (SIGTERM) and Windows (TerminateProcess)

---

## Subtask T014: Implement Tauri Event Bridge

**Purpose**: Convert sidecar JSON-RPC notifications into Tauri events that the React frontend can subscribe to.

**Steps**:
1. In the stdout reader task (from T012), when a notification (no `id`) is received:
   - Map `"state.serverChanged"` → emit Tauri event `"state:server-changed"` with params
   - Map `"state.syncCompleted"` → emit `"state:sync-completed"`
   - Map `"state.governanceDecision"` → emit `"state:governance-decision"`
   - Map `"state.error"` → emit `"state:error"`
2. Use `app_handle.emit("event-name", payload)` to broadcast to all windows
3. Frontend subscribes via `listen("state:server-changed", callback)`

**Files**:
- Update `apps/desktop-companion/src-tauri/src/sidecar.rs` (~40 lines)

**Validation**:
- [ ] Sidecar notification `state.serverChanged` arrives as Tauri event in webview
- [ ] Event payloads are correctly serialized as JSON

---

## Subtask T015: Implement Tauri Commands

**Purpose**: Create Tauri commands that the React frontend invokes, proxying to the sidecar.

**Steps**:
1. Create `apps/desktop-companion/src-tauri/src/commands.rs`:
   - `#[tauri::command] async fn get_servers(state) -> Result<Value>`
   - `#[tauri::command] async fn start_server(state, name: String) -> Result<Value>`
   - `#[tauri::command] async fn stop_server(state, name: String) -> Result<Value>`
   - `#[tauri::command] async fn restart_server(state, name: String) -> Result<Value>`
   - `#[tauri::command] async fn trigger_sync(state) -> Result<Value>`
   - `#[tauri::command] async fn get_sync_status(state) -> Result<Value>`
   - `#[tauri::command] async fn get_skills(state) -> Result<Value>`
   - `#[tauri::command] async fn get_governance_mode(state) -> Result<Value>`
   - `#[tauri::command] async fn get_governance_decisions(state, limit: u32) -> Result<Value>`
   - `#[tauri::command] async fn get_usage_summary(state, days: u32) -> Result<Value>`
   - `#[tauri::command] async fn query_usage(state, params: Value) -> Result<Value>`
   - `#[tauri::command] async fn health_check(state) -> Result<Value>`
   - `#[tauri::command] async fn detect_chrome(state) -> Result<Value>`
   - `#[tauri::command] async fn start_onboarding(state, params: Value) -> Result<Value>`
2. Each command: extract sidecar handle from state, call `send_request(method, params)`, return result
3. Register all commands in `main.rs` via `.invoke_handler(tauri::generate_handler![...])`

**Files**:
- `apps/desktop-companion/src-tauri/src/commands.rs` (new, ~120 lines)
- Update `apps/desktop-companion/src-tauri/src/main.rs` (register commands)

**Validation**:
- [ ] `invoke("get_servers")` from webview returns server list from sidecar
- [ ] `invoke("health_check")` returns `{ ok: true }`
- [ ] Commands return proper errors when sidecar is unavailable

---

## Subtask T016: Orphaned Process Cleanup

**Purpose**: Detect and clean up stale sidecar/MCP processes from previous crashes.

**Steps**:
1. On app startup (before spawning new sidecar):
   - Read PID file from app data directory (`companion-pids.json`)
   - For each PID, check if process exists
   - If exists and matches expected process name, kill it
   - Remove stale PID file
2. After spawning new sidecar, write new PID file
3. On clean shutdown, remove PID file

**Files**:
- Update `apps/desktop-companion/src-tauri/src/sidecar.rs` (~40 lines)

**Validation**:
- [ ] After force-killing the app, next launch cleans up orphaned processes
- [ ] PID file is created on startup and removed on clean shutdown

---

## Definition of Done

- [ ] Sidecar spawns on app launch and responds to health checks
- [ ] Graceful shutdown terminates sidecar within 5 seconds
- [ ] Sidecar notifications arrive as Tauri events in the webview
- [ ] All Tauri commands proxy correctly to sidecar methods
- [ ] Orphaned processes from previous crashes are cleaned up
- [ ] `cargo test` passes for all Rust code

## Risks

- **stdio buffering**: Ensure stdout is line-buffered on both Node.js and Rust sides. Node.js may buffer stdout when not connected to a TTY.
- **Request correlation**: Race conditions with concurrent requests. Use a monotonically increasing ID counter and proper locking.
- **Platform differences**: SIGTERM vs TerminateProcess behavior. Test shutdown on both macOS and Windows.

## Activity Log

- 2026-03-14T22:34:42Z – claude-opus – shell_pid=46136 – lane=doing – Started implementation via workflow command
- 2026-03-14T22:40:59Z – claude-opus – shell_pid=46136 – lane=done – All 5 subtasks complete. Sidecar spawn/monitor/shutdown, event bridge, 17 Tauri commands, orphan cleanup. 867 tests pass, typecheck clean.
