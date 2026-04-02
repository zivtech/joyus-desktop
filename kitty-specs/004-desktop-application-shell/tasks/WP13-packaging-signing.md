---
work_package_id: WP13
title: Packaging, Signing & Icons
lane: done
dependencies: []
subtasks: [T053, T054, T055, T056, T057]
agent: claude-opus
shell_pid: '92423'
review_status: approved
reviewed_by: Alex Urevick-Ackelsberg
history:
- date: '2026-03-14'
  event: created
  note: Generated from spec-kitty.tasks
---

# WP13 — Packaging, Signing & Icons

**Objective**: Configure Tauri bundle settings for production, create app icons, set up code signing for both platforms, and implement the uninstall cleanup prompt.

**Implementation command**: `spec-kitty implement WP13 --base WP12`

## Context

This WP prepares the app for distribution. Tauri handles most packaging automatically, but code signing, notarization, and icon generation require explicit configuration. The uninstall cleanup prompt (FR-020) is also handled here since it's part of the install/uninstall lifecycle.

---

## Subtask T053: Tauri Bundle Configuration

**Steps**:
1. Update `tauri.conf.json` bundle section:
   ```json
   {
     "bundle": {
       "active": true,
       "identifier": "com.joyus.desktop-companion",
       "icon": ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.icns", "icons/icon.ico"],
       "targets": ["dmg", "nsis"],
       "macOS": {
         "minimumSystemVersion": "10.15",
         "signingIdentity": null,
         "entitlements": null
       },
       "windows": {
         "certificateThumbprint": null,
         "digestAlgorithm": "sha256",
         "nsis": {
           "installMode": "currentUser",
           "displayLanguageSelector": false
         }
       }
     }
   }
   ```
2. Set `productName`, `version` (from package.json), `copyright`, `category`
3. Configure NSIS for Windows (user-level install, no admin required)

**Files**:
- Update `src-tauri/tauri.conf.json` (bundle section)

**Validation**:
- [ ] `cargo tauri build` produces .dmg on macOS
- [ ] `cargo tauri build` produces .exe installer on Windows
- [ ] Bundle includes Node.js sidecar binary and sidecar script

---

## Subtask T054: App Icons

**Steps**:
1. Create or generate app icons in required sizes:
   - `icon.icns` (macOS app icon)
   - `icon.ico` (Windows app icon)
   - `32x32.png`, `128x128.png`, `128x128@2x.png` (Tauri required sizes)
2. Create tray icon variants (from WP07, but stored here):
   - `tray-normal.png` (22x22, for macOS menu bar)
   - `tray-warning.png` (22x22)
   - `tray-error.png` (22x22)
3. Use Tauri's icon generation tool: `cargo tauri icon <source-1024x1024.png>`
4. Place all icons in `src-tauri/icons/`

**Files**:
- `src-tauri/icons/` (multiple icon files)

**Validation**:
- [ ] macOS app shows correct icon in Dock and Finder
- [ ] Windows app shows correct icon in taskbar and Start menu
- [ ] Tray icons are visible on both platforms

---

## Subtask T055: macOS Code Signing & Notarization

**Steps**:
1. Configure environment variables for CI:
   - `APPLE_CERTIFICATE`: base64-encoded .p12 certificate
   - `APPLE_CERTIFICATE_PASSWORD`: certificate password
   - `APPLE_ID`: Apple Developer account email
   - `APPLE_PASSWORD`: app-specific password for notarization
   - `APPLE_TEAM_ID`: Apple Developer Team ID
2. Tauri handles signing and notarization automatically when these env vars are set during `cargo tauri build`
3. For local development: builds are unsigned (acceptable for testing)
4. Document the certificate setup process

**Files**:
- Create `docs/signing/macos-signing.md` (new, ~30 lines documentation)

**Validation**:
- [ ] Signed .dmg passes macOS Gatekeeper
- [ ] Unsigned debug builds work locally without Gatekeeper issues (developer mode)

---

## Subtask T056: Windows Authenticode Signing

**Steps**:
1. Configure environment variables for CI:
   - `WINDOWS_CERTIFICATE`: base64-encoded .pfx certificate
   - `WINDOWS_CERTIFICATE_PASSWORD`: certificate password
2. Tauri uses `signtool.exe` when `certificateThumbprint` is set or when `WINDOWS_CERTIFICATE` env var is present
3. Document the Windows certificate acquisition process (EV or OV cert)

**Files**:
- Create `docs/signing/windows-signing.md` (new, ~25 lines documentation)

**Validation**:
- [ ] Signed .exe doesn't trigger Windows SmartScreen warning
- [ ] Unsigned debug builds work locally (with SmartScreen warning)

---

## Subtask T057: Uninstall Cleanup Prompt

**Steps**:
1. For Windows (NSIS): add custom uninstall page via NSIS script:
   - Radio buttons: "Remove everything (settings, skills, data)" vs "Remove app only"
   - If "remove everything": delete app data directory, remove .mcp.json managed entries, remove cached skills
   - If "remove app only": just remove the application files
2. For macOS: since .dmg doesn't have an uninstaller, create a "Reset" option in Settings page:
   - "Reset Desktop Companion" button in Settings
   - Confirmation dialog with same two options
   - Executes cleanup and optionally moves app to Trash
3. Both paths:
   - Stop all MCP server processes before cleanup
   - Remove managed entries from `.mcp.json`
   - Optionally delete `~/.claude/.skill-sync-cache/`

**Files**:
- For NSIS: `src-tauri/nsis/` custom scripts (if needed) or configure via tauri.conf.json
- Update `src/ui/pages/Settings.tsx` (add Reset section, ~30 lines)
- Create cleanup logic in sidecar or Rust

**Validation**:
- [ ] Windows uninstaller shows cleanup choice
- [ ] "Remove everything" cleans all data
- [ ] "Remove app only" leaves settings and skills intact
- [ ] MCP processes are stopped before uninstall

---

## Definition of Done

- [ ] Builds produce signed installers for both platforms
- [ ] App icons display correctly everywhere
- [ ] macOS notarization passes
- [ ] Windows SmartScreen doesn't block signed installer
- [ ] Uninstall/reset offers cleanup choice

## Activity Log

- 2026-03-15T00:20:10Z – claude-opus – shell_pid=92423 – lane=doing – Started implementation via workflow command
- 2026-03-15T00:23:40Z – claude-opus – shell_pid=92423 – lane=done – Packaging config, signing docs, uninstall cleanup
- 2026-03-15T00:24:44Z – claude-opus – shell_pid=92423 – lane=done – Complete
