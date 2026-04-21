---
work_package_id: WP12
title: Auto-Update
dependencies: []
subtasks: [T049, T050, T051, T052]
history:
- date: '2026-03-14'
  event: created
  note: Generated from spec-kitty.tasks
authoritative_surface: ''
execution_mode: code_change
mission_id: 01KPR4E967F61H0B7K24440QG2
owned_files:
- kitty-specs/004-desktop-application-shell/quickstart.md
- src/main.rs
- src/ui/App.tsx
- src/ui/components/UpdateBanner.tsx
- src/updater.rs
wp_code: WP12
---

# WP12 — Auto-Update

**Objective**: Configure Tauri's built-in updater, implement the update check/download/verify/restart flow, add UI notification, and set up signing key management.

**Implementation command**: `spec-kitty implement WP12 --base WP03`

## Context

Tauri v2's `tauri-plugin-updater` provides background update checking, download, signature verification, and installation. It requires a public key embedded in the app and a server-hosted JSON manifest describing available versions.

---

## Subtask T049: Configure tauri-plugin-updater

**Steps**:
1. Update `tauri.conf.json` with updater configuration:
   ```json
   {
     "plugins": {
       "updater": {
         "endpoints": [
           "https://releases.joyus.dev/desktop-companion/update/{{target}}/{{arch}}/{{current_version}}"
         ],
         "pubkey": "<PUBLIC_KEY>"
       }
     }
   }
   ```
2. The endpoint returns JSON matching Tauri's update manifest format (see research.md R4)
3. Register the updater plugin in `main.rs`

**Files**:
- Update `src-tauri/tauri.conf.json` (add updater config)
- Update `src-tauri/src/main.rs` (register plugin, ~3 lines)

**Validation**:
- [ ] Plugin registers without errors
- [ ] Config is valid and parseable

---

## Subtask T050: Update Check, Download & Restart

**Steps**:
1. Create `apps/desktop-companion/src-tauri/src/updater.rs`:
   - On app startup (after a 30-second delay), check for updates
   - If update available: download in background
   - After download: verify signature against embedded public key
   - If valid: store update, notify frontend
   - If invalid: discard, log error
2. Add periodic check every 4 hours
3. Add Tauri command `check_for_update()` for manual check from Settings
4. Add Tauri command `install_update()` that applies the update and restarts
5. On restart: sidecar is stopped, update is applied, app relaunches

**Files**:
- `apps/desktop-companion/src-tauri/src/updater.rs` (new, ~80 lines)
- Update `src-tauri/src/main.rs` (register commands, start check timer)

**Validation**:
- [ ] App checks for updates on startup (with delay)
- [ ] Valid update is downloaded and signature verified
- [ ] Invalid signature causes update to be discarded
- [ ] Manual check from Settings works
- [ ] Restart applies update and relaunches app

---

## Subtask T051: Update Notification UI

**Steps**:
1. Add Tauri event `update:available` emitted when an update is ready to install:
   ```json
   { "version": "1.2.0", "notes": "Bug fixes..." }
   ```
2. In React dashboard, add an `UpdateBanner` component:
   - Listens for `update:available` event
   - Shows banner: "Update v1.2.0 available — Restart Now | Later"
   - "Restart Now" calls `invoke("install_update")`
   - "Later" dismisses the banner (shown again on next dashboard open)
3. Banner appears at top of all dashboard pages

**Files**:
- `apps/desktop-companion/src/ui/components/UpdateBanner.tsx` (new, ~40 lines)
- Update `src/ui/App.tsx` to include banner

**Validation**:
- [ ] Banner appears when update is available
- [ ] "Restart Now" triggers update + restart
- [ ] "Later" dismisses banner

---

## Subtask T052: Signing Key Generation & Documentation

**Steps**:
1. Generate Tauri update signing keypair:
   ```bash
   cargo tauri signer generate -w ~/.tauri/joyus-desktop.key
   ```
2. Document key management:
   - Private key: stored in CI secrets (`TAURI_SIGNING_PRIVATE_KEY`)
   - Public key: embedded in `tauri.conf.json`
   - Key rotation procedure: generate new pair, update both, release new version that trusts both keys during transition
3. Add key generation instructions to quickstart.md

**Files**:
- Update `kitty-specs/004-desktop-application-shell/quickstart.md` (key management docs)

**Validation**:
- [ ] Keypair generates successfully
- [ ] Public key is embedded in tauri.conf.json
- [ ] Documentation covers key rotation

---

## Definition of Done

- [ ] Updater checks for updates on startup and periodically
- [ ] Downloads are signature-verified before installation
- [ ] Update banner appears in dashboard with restart option
- [ ] Signing keys are generated and documented
- [ ] Offline mode: no errors when update server unreachable

## Activity Log

- 2026-03-14T22:51:54Z – agent-wp12 – shell_pid=66406 – lane=doing – Started implementation via workflow command
- 2026-03-14T22:57:00Z – agent-wp12 – shell_pid=66406 – lane=for_review – Complete: updater.rs, UpdateBanner.tsx, tauri.conf.json updater config, key management docs. typecheck and 875 tests pass.
- 2026-03-14T22:57:44Z – agent-wp12 – shell_pid=66406 – lane=done – Tauri updater configured, background checker with 30s delay/4h interval, UpdateBanner React component, signing key docs. 875 tests pass.
