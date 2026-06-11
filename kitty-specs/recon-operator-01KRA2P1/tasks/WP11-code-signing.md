---
work_package_id: WP11
title: Code Signing & Notarization
dependencies: []
requirement_refs:
- FR-014
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts for this feature were generated on main. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into main unless the human explicitly redirects the landing branch.
subtasks:
- T043
- T044
- T045
- T046
history:
- date: '2026-05-10'
  event: created
  note: Generated via /spec-kitty.tasks
authoritative_surface: .github/workflows/
execution_mode: code_change
mission_id: 01KRA2P11PNXGNMMJQYQYP34M8
owned_files:
- apps/desktop-companion/src-tauri/entitlements.plist
- .github/workflows/build-desktop.yml
tags: []
wp_code: WP11
---

# WP11: Code Signing & Notarization

## Overview

Set up macOS code signing and Apple notarization so the Desktop Companion distributes as a Gatekeeper-approved DMG. This requires a Developer ID Application certificate, entitlements for the Node sidecar and Keychain access, and a GitHub Actions workflow that builds, signs, notarizes, and uploads the DMG as a release artifact.

**External dependency**: This WP requires an Apple Developer ID Application certificate for Example Co LLC. If the certificate is not yet available, T043 and T044 can be completed with a placeholder Team ID, and T045/T046 can have the signing/notarization steps drafted but skipped in CI until the secrets are provisioned. Document the placeholder clearly.

## Codebase Pattern

Tauri build configuration is in `apps/desktop-companion/src-tauri/tauri.conf.json`. CI workflows live in `.github/workflows/`. The entitlements plist is referenced from `tauri.conf.json` via the `macOS.entitlements` key. Signing identity is set via `macOS.signingIdentity`.

## Subtasks

### T043 — Configure signing identity in `tauri.conf.json`

In `apps/desktop-companion/src-tauri/tauri.conf.json`, locate or create the `bundle.macOS` section and add:

```json
"macOS": {
  "signingIdentity": "Developer ID Application: Example Co LLC (TEAM_ID)",
  "entitlements": "entitlements.plist"
}
```

Replace `TEAM_ID` with the actual 10-character Apple Team ID from the Apple Developer portal. If not yet available, use the placeholder `"PLACEHOLDER_TEAM_ID"` and add a comment (in a sibling `"_note"` field or inline comment if the format allows) indicating the placeholder must be replaced before release.

Verify the existing `tauri.conf.json` structure — only add fields, do not remove or reorder existing ones.

### T044 — Create `entitlements.plist`

Create `apps/desktop-companion/src-tauri/entitlements.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <!-- Required for the Node.js sidecar binary, which contains JIT-compiled code -->
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <!-- Keychain access group for com.joyus.desktop-companion credentials -->
    <key>keychain-access-groups</key>
    <array>
        <string>$(AppIdentifierPrefix)com.joyus.desktop-companion</string>
    </array>
</dict>
</plist>
```

Verify the path matches what was set in `tauri.conf.json` under `macOS.entitlements`. The path is relative to the `src-tauri/` directory in Tauri's build context.

### T045 — Create `.github/workflows/build-desktop.yml`

Create `.github/workflows/build-desktop.yml` with the following structure:

**Trigger**: Push to `main` and version tags matching `desktop/v*`.

**Job: `build-macos`**:
- Runner: `macos-14` (Apple Silicon) or `macos-13` (Intel) — use `macos-latest` if universal binary is built via `--target universal-apple-darwin`.
- Steps:
  1. `actions/checkout@v4`
  2. Install Rust toolchain — add targets `aarch64-apple-darwin` and `x86_64-apple-darwin` for universal build.
  3. Install Node.js (match version used in the project's `.nvmrc` or `package.json` `engines` field).
  4. Install pnpm and run `pnpm install`.
  5. **Import signing certificate**:
     ```yaml
     - name: Import signing certificate
       env:
         CERTIFICATE_P12: ${{ secrets.APPLE_CERTIFICATE_P12 }}
         CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
       run: |
         echo "$CERTIFICATE_P12" | base64 --decode > certificate.p12
         security create-keychain -p "" build.keychain
         security import certificate.p12 -k build.keychain -P "$CERTIFICATE_PASSWORD" -T /usr/bin/codesign
         security list-keychains -s build.keychain
         security default-keychain -s build.keychain
         security unlock-keychain -p "" build.keychain
         security set-key-partition-list -S apple-tool:,apple: -s -k "" build.keychain
         rm certificate.p12
     ```
  6. **Build universal DMG**:
     ```yaml
     - name: Build Desktop Companion
       env:
         APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
       run: pnpm tauri build --target universal-apple-darwin
       working-directory: apps/desktop-companion
     ```
  7. **Upload DMG artifact**: Use `actions/upload-artifact@v4` to upload the `.dmg` from `apps/desktop-companion/src-tauri/target/universal-apple-darwin/release/bundle/dmg/`.
  8. **On release tag** (condition: `startsWith(github.ref, 'refs/tags/desktop/v')`): Use `softprops/action-gh-release@v2` to upload the DMG as a release asset.

**Required secrets** (document in a comment block at the top of the workflow file):
```
APPLE_SIGNING_IDENTITY   — e.g., "Developer ID Application: Example Co LLC (XXXXXXXXXX)"
APPLE_CERTIFICATE_P12    — Base64-encoded .p12 certificate
APPLE_CERTIFICATE_PASSWORD — Password for the .p12 file
APPLE_TEAM_ID            — 10-character Apple Team ID
APPLE_ID                 — Apple ID email for notarytool
APPLE_ID_PASSWORD        — App-specific password for notarytool
```

### T046 — Add notarization step after signing

After the build step in `build-desktop.yml`, add a notarization step that runs only when signing is active (i.e., when `APPLE_SIGNING_IDENTITY` secret is present — use `if: env.APPLE_SIGNING_IDENTITY != ''` or a dedicated condition):

```yaml
- name: Notarize DMG
  env:
    APPLE_ID: ${{ secrets.APPLE_ID }}
    APPLE_ID_PASSWORD: ${{ secrets.APPLE_ID_PASSWORD }}
    APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
  run: |
    DMG_PATH=$(find apps/desktop-companion/src-tauri/target/universal-apple-darwin/release/bundle/dmg -name "*.dmg" | head -1)
    echo "Notarizing: $DMG_PATH"
    xcrun notarytool submit "$DMG_PATH" \
      --apple-id "$APPLE_ID" \
      --password "$APPLE_ID_PASSWORD" \
      --team-id "$APPLE_TEAM_ID" \
      --wait
    xcrun stapler staple "$DMG_PATH"
    echo "Notarization complete."
```

Fail the workflow if `notarytool submit` exits with a non-zero code (the default `set -e` behavior covers this). Add a `stapler validate` call after stapling to confirm the staple was applied successfully.

## Success Criteria

- The DMG produced by `build-desktop.yml` installs on a clean macOS machine without a Gatekeeper warning or quarantine prompt.
- Keychain operations in WP08 work without a per-launch macOS permission prompt (entitlements correctly grant Keychain access).
- The GitHub Actions workflow completes without errors when all required secrets are present.
- On a version tag push, the notarized DMG appears as a release asset.
- When signing secrets are absent (e.g., on forks or PRs from external contributors), the workflow still builds successfully — skip signing/notarization steps gracefully rather than failing.
