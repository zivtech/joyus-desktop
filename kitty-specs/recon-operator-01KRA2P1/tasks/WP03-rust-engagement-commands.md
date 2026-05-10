---
work_package_id: WP03
title: Rust Engagement Commands
dependencies: []
requirement_refs:
- FR-002
- FR-003
- FR-004
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts generated on main. During implementation, this WP may branch from a dependency-specific base. Completed changes must merge back into main.
subtasks:
- T011
- T012
- T013
- T014
- T015
history:
- date: '2026-05-10'
  event: created
  note: Generated via /spec-kitty.tasks
authoritative_surface: apps/desktop-companion/src-tauri/src/recon.rs
execution_mode: code_change
mission_id: 01KRA2P11PNXGNMMJQYQYP34M8
owned_files:
- apps/desktop-companion/src-tauri/src/recon.rs
- apps/desktop-companion/src-tauri/src/commands.rs
- apps/desktop-companion/src-tauri/src/lib.rs
tags: []
wp_code: WP03
---

# WP03: Rust Engagement Commands

## Overview

Implement the Tauri Rust commands that manage Recon engagement processes from the main process. These commands handle spawning the `claude` CLI as a background child process, streaming progress events to the frontend, tracking process state, and reporting engagement status via a filesystem sentinel.

## Codebase Pattern

`#[command]` functions live in `src-tauri/src/commands.rs`. Most proxy to the sidecar via `state.send_request("method", params).await`. Direct commands take `AppHandle`. All commands are registered in `tauri::generate_handler![...]` in `lib.rs` (or `main.rs` depending on version).

**Verified CLI invocation**:
```
claude -p "/joyus-recon --rfp \"{clientName}\"" --permission-mode dontAsk --output-format stream-json --max-budget-usd 25
```

## Subtasks

### T011 — Create `recon.rs` module with state types

Create `apps/desktop-companion/src-tauri/src/recon.rs`.

Define the following types:

```rust
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub struct ReconProcess {
    pub pid: u32,
    pub launch_time: String,      // ISO-8601
    pub engagement_id: String,
    pub engagement_dir: String,
}

pub type ReconState = Arc<Mutex<HashMap<String, ReconProcess>>>;
```

- `ReconState` is a shared, thread-safe map from `engagement_id` to `ReconProcess`.
- This module owns all recon-specific types; command implementations in subsequent tasks import from here.
- Add `pub mod recon;` to `lib.rs` (or `main.rs`) so the module is visible.

### T012 — Implement `launch_recon` command

Add `#[command] pub async fn launch_recon(...)` in `recon.rs` or `commands.rs` (implementer's choice; document the location).

**Signature**:
```rust
pub async fn launch_recon(
    client_name: String,
    engagement_dir: String,
    max_budget: Option<u32>,
    state: tauri::State<'_, ReconState>,
    app_handle: tauri::AppHandle,
) -> Result<serde_json::Value, String>
```

**Behavior**:
1. Read credential file at `~/Library/Application Support/com.joyus.desktop-companion/credentials.env`. Parse `KEY=value` lines into a `HashMap<String, String>`. Lines starting with `#` and blank lines are ignored.
2. Determine the budget: `max_budget.unwrap_or(25)`.
3. Spawn `claude` via `tokio::process::Command`:
   - Args: `-p`, `/joyus-recon --rfp "{client_name}"`, `--permission-mode`, `dontAsk`, `--output-format`, `stream-json`, `--max-budget-usd`, `{budget}`
   - Inject credential env vars from the parsed credential map (pass each as `.env(key, value)`).
   - Set working directory to `engagement_dir`.
   - Capture stdout (`Stdio::piped()`); stderr can be inherited or captured.
   - Do NOT await process completion — spawn and return immediately.
4. In a detached `tokio::spawn` task:
   - Read stdout line by line.
   - For each line, attempt to parse as JSON. If valid and contains a recognizable `stream-json` event field, emit a `recon:progress` Tauri event via `app_handle.emit("recon:progress", payload)`.
   - When stdout EOF is reached, emit a `recon:stream-end` event with `{ engagement_id }`.
5. Store `ReconProcess { pid, launch_time, engagement_id: engagement_id.clone(), engagement_dir }` in `ReconState` under the `engagement_id` key.
6. Return immediately: `Ok(json!({ "pid": pid, "launchTime": launch_time, "engagementId": engagement_id }))`.

**engagement_id generation**: Use the same slug + timestamp format as the sidecar `recon.create` handler, or accept it as a parameter passed from the frontend (preferred — avoids duplication).

**Error handling**: If `claude` binary is not found on PATH, return `Err("claude CLI not found on PATH".to_string())`. If credential file is absent, proceed with no credential env vars (the skill will fail later with a descriptive error from Claude).

### T013 — Implement `get_engagement_status` command

Add `#[command] pub async fn get_engagement_status(...)`.

**Signature**:
```rust
pub async fn get_engagement_status(
    engagement_id: String,
    state: tauri::State<'_, ReconState>,
) -> Result<serde_json::Value, String>
```

**Behavior**:
1. Look up `engagement_id` in `ReconState`. If not found: return `{ "status": "unknown" }`.
2. Check if the process is still alive:
   - macOS/Linux: send signal 0 to the PID (`libc::kill(pid, 0)`). If `errno == ESRCH`, process has exited.
   - Windows: use `OpenProcess` / `GetExitCodeProcess` (or use the `sysinfo` crate for cross-platform).
3. If process is running: return `{ "status": "running", "pid": pid }`.
4. If process has exited:
   - Remove from `ReconState`.
   - Read `{engagement_dir}/.recon-complete` sentinel file. If present, parse as JSON and extract: `status`, `timestamp` (as `completedAt`), `phases_completed` (as `phasesCompleted`), `output_files` (as `outputFiles`), `error`.
   - Return `{ "status": sentinel.status, "completedAt": ..., "phasesCompleted": ..., "outputFiles": [...], "summary": null }` on success, or `{ "status": "error", "error": sentinel.error, "lastPhaseCompleted": sentinel.last_phase_completed }` on error.
   - If sentinel is absent: return `{ "status": "complete", "note": "no metadata — sentinel not written" }`.

### T014 — Implement `cancel_engagement` command

Add `#[command] pub async fn cancel_engagement(...)`.

**Signature**:
```rust
pub async fn cancel_engagement(
    engagement_id: String,
    state: tauri::State<'_, ReconState>,
) -> Result<serde_json::Value, String>
```

**Behavior**:
1. Look up `engagement_id` in `ReconState`. If not found: return `Err("engagement not found".to_string())`.
2. Send SIGTERM to the process PID.
   - macOS/Linux: `libc::kill(pid as i32, libc::SIGTERM)`.
   - Windows: `TerminateProcess`.
3. Remove the `engagement_id` entry from `ReconState`.
4. Return `Ok(json!({ "cancelled": true, "engagementId": engagement_id }))`.

**Error handling**: If `kill` returns an error (e.g., process already gone), treat as successful cancellation — return `{ "cancelled": true }` anyway and ensure the entry is removed from state.

### T015 — Add `create_engagement` proxy command and register all commands

**`create_engagement` proxy** (in `commands.rs`):
- A thin `#[command]` that calls sidecar method `recon.create` with `{ clientName, url, accessMode }`.
- Follow the pattern of existing sidecar proxy commands in `commands.rs`.
- Returns the sidecar response directly.

**Command registration** (in `lib.rs` or `main.rs`):
Add ALL new commands to `tauri::generate_handler![...]`:
- `launch_recon`
- `get_engagement_status`
- `cancel_engagement`
- `create_engagement`

**Managed state** (in `lib.rs` or `main.rs`):
Register `ReconState` as managed state:
```rust
.manage(recon::ReconState::default())
```
where `ReconState` implements `Default` as `Arc::new(Mutex::new(HashMap::new()))`.

## Success Criteria

- `launch_recon` spawns a child process with the correct args and injects credential env vars. PID is stored in `ReconState`.
- `recon:progress` events are emitted to the frontend as stdout lines arrive (verified by observing events in the frontend devtools or a test harness).
- `get_engagement_status` returns `"running"` while the process is alive and transitions to `"complete"` or `"error"` within 1 second of process exit.
- `cancel_engagement` terminates the process and returns `{ cancelled: true }`.
- `create_engagement` proxies correctly to the sidecar `recon.create` method.
- All four commands are registered and callable from the frontend via `invoke(...)`.
- Rust compiles without errors or warnings (`cargo build` passes).
