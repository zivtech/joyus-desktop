---
work_package_id: WP07
title: System Tray & Platform Integration
dependencies: []
subtasks: [T031, T032, T033, T034]
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
- src/tray.rs
wp_code: WP07
---

# WP07 — System Tray & Platform Integration

**Objective**: Implement the system tray icon with context menu, auto-start on login for both platforms, dynamic tray icon status updates, and app-level crash reporting.

**Implementation command**: `spec-kitty implement WP07 --base WP03`

## Context

The system tray is the user's primary interaction point when the dashboard window is hidden. It provides quick access to the dashboard, manual sync trigger, and quit. The tray icon changes appearance to reflect system health (normal/warning/error).

---

## Subtask T031: System Tray with Context Menu

**Steps**:
1. Create `apps/desktop-companion/src-tauri/src/tray.rs`:
   - Build menu: "Open Dashboard", "Sync Now", separator, "Quit"
   - `on_menu_event` handler:
     - "open": show/focus main window via `app.get_webview_window("main").unwrap().show()`
     - "sync": invoke sidecar `sync.trigger` method
     - "quit": trigger graceful shutdown then `app.exit(0)`
   - Left-click on tray icon (macOS/Windows): toggle dashboard window visibility
2. Call `setup_tray(app)` from `main.rs` setup hook
3. Create tray icons: 22x22 PNG for macOS menu bar, 16x16 + 32x32 ICO for Windows

**Files**:
- `apps/desktop-companion/src-tauri/src/tray.rs` (new, ~60 lines)
- Update `src-tauri/src/main.rs` (~5 lines)
- `src-tauri/icons/tray-normal.png`, `tray-warning.png`, `tray-error.png` (new assets)

**Validation**:
- [ ] Tray icon appears on both macOS and Windows
- [ ] Context menu shows all items
- [ ] "Open Dashboard" shows the window
- [ ] "Sync Now" triggers sync
- [ ] "Quit" shuts down cleanly

---

## Subtask T032: Auto-Start on Login

**Steps**:
1. Register `tauri-plugin-autostart` in `main.rs`
2. Configure to auto-start by default (can be toggled via Settings page later)
3. Platform behavior:
   - macOS: creates Launch Agent plist in `~/Library/LaunchAgents/`
   - Windows: adds registry entry in `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
4. Add Tauri command `toggle_autostart(enabled: bool)` for the Settings page to use

**Files**:
- Update `src-tauri/src/main.rs` (plugin registration, ~5 lines)
- Update `src-tauri/src/commands.rs` (toggle command, ~15 lines)

**Validation**:
- [ ] After install, app auto-starts on next login (macOS)
- [ ] After install, app auto-starts on next login (Windows)
- [ ] `toggle_autostart(false)` disables auto-start

---

## Subtask T033: Dynamic Tray Icon Status

**Steps**:
1. Add `update_tray_icon(app: &AppHandle, status: &str)` to `tray.rs`:
   - "normal": green/default icon — all servers healthy
   - "warning": yellow icon — at least one server restarting or sync failed
   - "error": red icon — at least one server in error state
2. Listen to sidecar `state:server-changed` and `state:error` events
3. Compute aggregate status from all server states and update tray icon
4. Update tray tooltip text with brief status summary

**Files**:
- Update `apps/desktop-companion/src-tauri/src/tray.rs` (~30 lines)
- Update `src-tauri/src/main.rs` (event listener, ~15 lines)

**Validation**:
- [ ] Tray icon changes to warning when a server restarts
- [ ] Tray icon changes to error when a server exceeds max restarts
- [ ] Tray icon returns to normal when all servers are healthy
- [ ] Tooltip shows "All servers running" or "1 server in error"

---

## Subtask T034: App-Level Crash Reporting

**Steps**:
1. In Rust, set a panic hook that:
   - Logs the panic info to a crash log file
   - Attempts to send a `state.error` notification via sidecar (if alive)
2. On next startup, check for crash log files and send them via telemetry (if opted in):
   - Read crash log, extract message and backtrace
   - Send via sidecar's telemetry pathway
   - Delete crash log after successful send
3. Crash logs stored in Tauri app data directory: `crash-YYYY-MM-DD-HH-MM-SS.log`

**Files**:
- Update `src-tauri/src/main.rs` (panic hook, crash log check, ~40 lines)

**Validation**:
- [ ] Rust panic creates a crash log file
- [ ] Next startup detects and reports the crash log
- [ ] Crash reporting respects telemetry opt-out

---

## Definition of Done

- [ ] System tray works on both platforms with full context menu
- [ ] Auto-start configures correctly on both macOS and Windows
- [ ] Tray icon reflects system health dynamically
- [ ] App crashes are logged and reported on next startup

## Activity Log

- 2026-03-14T22:51:53Z – agent-wp07 – shell_pid=66406 – lane=doing – Started implementation via workflow command
- 2026-03-14T22:55:36Z – agent-wp07 – shell_pid=66406 – lane=done – System tray with context menu, dynamic tooltip, event listener. Autostart via plugin. Real icons deferred to WP13.
