---
work_package_id: WP08
title: Keychain Module
dependencies:
- WP07
requirement_refs:
- FR-011
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts generated on main. During implementation, this WP may branch from a dependency-specific base. Completed changes must merge back into main.
subtasks:
- T031
- T032
- T033
- T034
- T035
history:
- date: '2026-05-10'
  event: created
  note: Generated via /spec-kitty.tasks
authoritative_surface: apps/desktop-companion/src-tauri/src/keychain.rs
execution_mode: code_change
mission_id: 01KRA2P11PNXGNMMJQYQYP34M8
owned_files:
- apps/desktop-companion/src-tauri/src/keychain.rs
- apps/desktop-companion/src-tauri/Cargo.toml
tags: []
wp_code: WP08
---

# WP08: Keychain Module

## Overview

Implement a Rust keychain module using `keyring-rs` to store, retrieve, and delete operator credentials in the macOS Keychain. Replace the flat `credentials.env` file as the primary credential store, with a one-time migration path for existing installs. The keychain module is invoked directly by Tauri commands — no sidecar proxy involved.

## Codebase Pattern

Rust Tauri commands live in `src-tauri/src/`. Each module is declared with `mod <name>;` in `lib.rs` and its commands added to `generate_handler![...]`. Commands use `#[tauri::command]` and may take `State<T>` or `AppHandle` as needed. Keychain operations use `keyring-rs` which calls the native macOS Keychain APIs.

## Subtasks

### T031 — Add `keyring` dependency to `Cargo.toml`

Add the following to `[dependencies]` in `apps/desktop-companion/src-tauri/Cargo.toml`:

```toml
keyring = "3"
```

Run `cargo check` after adding to confirm the dependency resolves without errors. If the minor version constraint conflicts with existing deps, adjust to the latest compatible `3.x` release.

### T032 — Create `keychain.rs` module

Create `apps/desktop-companion/src-tauri/src/keychain.rs`.

**Constants**:
```rust
const SERVICE: &str = "com.joyus.desktop-companion";
```

**Allowlist** — the exact five credential keys accepted:
```rust
const ALLOWED_KEYS: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "DATAFORSEO_LOGIN",
    "DATAFORSEO_PASSWORD",
    "GITHUB_TOKEN",
    "OPENAI_API_KEY",
];
```

**Functions**:

- `store_credential(key: &str, value: &str) -> Result<(), String>` — Validate `key` is in `ALLOWED_KEYS` (return `Err` with message `"credential key not allowed: {key}"` if not). Call `Entry::new(SERVICE, key)?.set_password(value)?`. Map errors to `String` via `.map_err(|e| e.to_string())`.

- `retrieve_credential(key: &str) -> Result<Option<String>, String>` — Call `Entry::new(SERVICE, key)?.get_password()`. If the error is `keyring::Error::NoEntry`, return `Ok(None)`. All other errors map to `Err(e.to_string())`. On success, return `Ok(Some(password))`.

- `delete_credential(key: &str) -> Result<(), String>` — Call `Entry::new(SERVICE, key)?.delete_credential()`. Map errors to `String`. `NoEntry` is treated as success (idempotent delete).

- `list_stored_keys() -> Vec<String>` — Iterate `ALLOWED_KEYS`. For each, call `retrieve_credential(key)`. If `Ok(Some(_))`, include the key in the returned `Vec<String>`. Silently skip errors and `Ok(None)` entries.

All `Entry::new` calls use `keyring::Entry::new(SERVICE, key)`.

### T033 — Register Tauri commands

These are direct Rust commands — they do NOT go through the sidecar proxy.

Add `mod keychain;` to `apps/desktop-companion/src-tauri/src/lib.rs`.

Create four `#[tauri::command]` functions in `keychain.rs` (or in a `commands` submodule):

- `keychain_store(key: String, value: String) -> Result<(), String>` — calls `keychain::store_credential(&key, &value)`
- `keychain_retrieve(key: String) -> Result<Option<String>, String>` — calls `keychain::retrieve_credential(&key)`
- `keychain_delete(key: String) -> Result<(), String>` — calls `keychain::delete_credential(&key)`
- `keychain_list() -> Vec<String>` — calls `keychain::list_stored_keys()`

Add all four to `generate_handler![...]` in `lib.rs`.

### T034 — Migration path from flat file

On first launch after upgrade, perform a one-time migration from the legacy `credentials.env` flat file to Keychain.

**Detection condition**: `credentials.env` exists in the app data directory AND `keychain_list()` returns an empty vec.

**Migration steps**:
1. Read `credentials.env`. Parse each line as `KEY=VALUE` (skip blank lines and lines starting with `#`).
2. For each parsed pair where `KEY` is in `ALLOWED_KEYS`: call `store_credential(key, value)`. Collect any errors without aborting the loop.
3. After attempting all pairs: call `list_stored_keys()` and confirm every key from the file that was in `ALLOWED_KEYS` is now present.
4. If all verified: delete `credentials.env`. Log a migration success event (use `log::info!` or equivalent).
5. If any verification fails: do NOT delete `credentials.env`. Log the error. The migration will retry on next launch.

Implement as a function `pub fn migrate_from_flat_file(app_data_dir: &std::path::Path)` called from the Tauri setup hook, before any commands are registered.

### T035 — Integrate Keychain into `launch_recon`

Modify the `launch_recon` command in `apps/desktop-companion/src-tauri/src/recon.rs` to prefer Keychain over flat file.

**Logic**:
1. Call `keychain::list_stored_keys()`. If the returned vec is non-empty, Keychain is the active store.
2. For each credential needed to launch the recon skill (all five keys from the allowlist): call `keychain::retrieve_credential(key)`. If `Ok(Some(val))`, use `Command::env(key, val)` to inject into the child process.
3. If `keychain::list_stored_keys()` returns empty: fall back to reading from `credentials.env` as before.
4. Credentials are injected via `Command::env(...)` in both paths — they are never written to disk or returned to the frontend.

Add a log line indicating which store was used (`"launching recon with keychain credentials"` vs `"launching recon with flat-file credentials (migration pending)"`).

## Success Criteria

- `cargo build` succeeds with `keyring = "3"` in deps.
- `keychain_store` / `keychain_retrieve` / `keychain_delete` / `keychain_list` are callable from the frontend via `safeInvoke`.
- Credentials written via `keychain_store` are visible in Keychain Access.app under `com.joyus.desktop-companion`.
- Migration is lossless: existing `credentials.env` content is fully transferred to Keychain and the flat file is deleted on success.
- `launch_recon` injects credentials from Keychain when entries are present, without any credential appearing in IPC responses or log output.
