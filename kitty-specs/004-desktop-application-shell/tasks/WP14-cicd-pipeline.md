---
work_package_id: WP14
title: CI/CD Pipeline
dependencies: []
subtasks: [T058, T059, T060, T061, T062]
history:
- date: '2026-03-14'
  event: created
  note: Generated from spec-kitty.tasks
authoritative_surface: src/
execution_mode: code_change
mission_id: 01KPR4E967F61H0B7K24440QG2
owned_files:
- src/**
wp_code: WP14
---

# WP14 — CI/CD Pipeline

**Objective**: Create the GitHub Actions workflow that builds, signs, and publishes the desktop application for both macOS and Windows, including update manifest generation.

**Implementation command**: `spec-kitty implement WP14 --base WP13`

## Context

The CI pipeline produces signed release artifacts for both platforms from a single workflow. It also generates the update manifest that the Tauri auto-updater consumes. Builds are triggered on release tags or manual dispatch.

---

## Subtask T058: GitHub Actions Workflow

**Steps**:
1. Create `.github/workflows/desktop-release.yml`:
   - Trigger: push tag `v*` or `workflow_dispatch`
   - Matrix: `[macos-latest, windows-latest]`
   - For macOS, build both `aarch64-apple-darwin` and `x86_64-apple-darwin` targets (universal binary or separate)
   - Steps per job:
     1. Checkout code
     2. Install Rust stable
     3. Install pnpm + Node.js 24
     4. `pnpm install`
     5. Run TypeScript tests (`pnpm test`)
     6. Run Rust tests (`cd apps/desktop-companion/src-tauri && cargo test`)
     7. Build sidecar (`pnpm --filter @joyus/desktop-companion build:sidecar`)
     8. Download Node.js binaries (`pnpm --filter @joyus/desktop-companion download:node`)
     9. Build Tauri app (`cargo tauri build`)
     10. Upload artifacts

**Files**:
- `.github/workflows/desktop-release.yml` (new, ~120 lines)

**Validation**:
- [ ] Workflow triggers on tag push
- [ ] Both macOS and Windows jobs run
- [ ] Tests pass before build

---

## Subtask T059: Code Signing in CI

**Steps**:
1. macOS signing secrets (GitHub repository secrets):
   - `APPLE_CERTIFICATE`: base64-encoded .p12
   - `APPLE_CERTIFICATE_PASSWORD`
   - `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`
2. Windows signing secrets:
   - `WINDOWS_CERTIFICATE`: base64-encoded .pfx
   - `WINDOWS_CERTIFICATE_PASSWORD`
3. Tauri update signing:
   - `TAURI_SIGNING_PRIVATE_KEY`: private key for update signatures
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (if password-protected)
4. In the workflow:
   - macOS: import certificate to keychain before build
   - Windows: set certificate env vars before build
   - Tauri reads these automatically during `cargo tauri build`

**Files**:
- Update `.github/workflows/desktop-release.yml` (add signing steps)

**Validation**:
- [ ] macOS build is signed and notarized
- [ ] Windows build is Authenticode signed
- [ ] Update bundles are signed with Tauri signing key

---

## Subtask T060: Node.js & Sidecar Bundling in CI

**Steps**:
1. Before `cargo tauri build`, run:
   - `pnpm --filter @joyus/desktop-companion build:sidecar` (esbuild the sidecar)
   - `pnpm --filter @joyus/desktop-companion download:node` (fetch platform Node.js)
2. For the matrix build:
   - macOS job downloads macOS Node.js binaries (arm64 + x86_64)
   - Windows job downloads Windows Node.js binary (x86_64)
3. Verify binaries exist before Tauri build starts

**Files**:
- Update `.github/workflows/desktop-release.yml` (add bundling steps)

**Validation**:
- [ ] Sidecar bundle is created before Tauri build
- [ ] Correct Node.js binaries are present for each platform
- [ ] Tauri build includes them in the final package

---

## Subtask T061: Release Artifacts

**Steps**:
1. After successful builds, upload artifacts:
   - macOS: `.dmg` file + `.tar.gz` (for updater)
   - Windows: `.exe` (NSIS installer) + `.zip` (for updater)
2. Use `actions/upload-artifact` for build artifacts
3. For tagged releases: use `softprops/action-gh-release` to create GitHub Release with all artifacts
4. Name convention: `joyus-desktop-companion-{version}-{platform}.{ext}`

**Files**:
- Update `.github/workflows/desktop-release.yml` (add upload steps)

**Validation**:
- [ ] GitHub Release contains all 4 artifacts (dmg, tar.gz, exe, zip)
- [ ] Artifact names follow convention
- [ ] Artifacts are downloadable and installable

---

## Subtask T062: Update Manifest Generation

**Steps**:
1. After uploading release artifacts, generate the update manifest JSON:
   ```json
   {
     "version": "1.2.0",
     "notes": "<from git tag message or CHANGELOG>",
     "pub_date": "<ISO 8601>",
     "platforms": {
       "darwin-aarch64": { "signature": "<from .sig file>", "url": "<github release asset URL>" },
       "darwin-x86_64": { "signature": "...", "url": "..." },
       "windows-x86_64": { "signature": "...", "url": "..." }
     }
   }
   ```
2. Tauri build generates `.sig` files alongside the update bundles — read these for signatures
3. Upload the manifest to the update endpoint (GitHub Pages, S3, or as a release asset)
4. The update endpoint URL in `tauri.conf.json` should resolve to this manifest

**Files**:
- Create `.github/scripts/generate-update-manifest.sh` (new, ~40 lines)
- Update `.github/workflows/desktop-release.yml` (add manifest step)

**Validation**:
- [ ] Manifest JSON is valid and contains all platforms
- [ ] Signatures match the Tauri-generated .sig files
- [ ] Update endpoint returns the manifest
- [ ] Running app detects the new version via updater

---

## Definition of Done

- [ ] CI workflow builds for both platforms
- [ ] Builds are code-signed and notarized
- [ ] Node.js and sidecar are bundled correctly
- [ ] GitHub Release contains all artifacts
- [ ] Update manifest is generated and accessible
- [ ] End-to-end: pushing a tag produces installable, auto-updating releases

## Activity Log

- 2026-03-15T00:20:18Z – agent-wp14 – shell_pid=93253 – lane=doing – Started implementation via workflow command
- 2026-03-15T00:23:40Z – agent-wp14 – shell_pid=93253 – lane=done – GitHub Actions CI/CD pipeline
- 2026-03-15T00:24:14Z – agent-wp14 – shell_pid=93253 – lane=done – Complete
