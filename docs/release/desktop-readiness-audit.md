# Desktop Release Readiness Audit

Date: 2026-04-04  
Target: signed macOS DMG + signed Windows EXE release candidate  
Verdicts required: `Core Signed RC` and `Marketed RC`

## Repo Baseline

- Feature status files materially mark `001`, `002`, `003`, `004`, and `005` as done.
- `006` is still in progress, `007` has an accepted spec but no `status.json`, and `008` is still in progress.
- The repo already contains a Tauri release workflow for macOS and Windows in `.github/workflows/desktop-release.yml`.
- Release-critical gaps are visible in the repo before any installer testing:
  - `apps/desktop-companion/src-tauri/icons/` contains only `README.md`; no generated icon or tray assets are present.
  - `apps/desktop-companion/src-tauri/tauri.conf.json` points at `../dist` but does not define a `beforeBuildCommand`.
  - `apps/desktop-companion/src-tauri/tauri.conf.json` still contains `"<TAURI_UPDATE_PUBLIC_KEY>"`.
  - `apps/desktop-companion/src-tauri/src/commands.rs` exposes `toggle_autostart()` as a log-only no-op.
  - No uninstall choice/cleanup implementation matching feature `004` FR-020 was found in the app shell or release workflow.

## Evidence Collected In This Audit

### Static evidence

- Feature specs and statuses: `kitty-specs/001-*` through `kitty-specs/008-*`
- Desktop shell and packaging: `apps/desktop-companion/src-tauri/tauri.conf.json`, `apps/desktop-companion/src-tauri/Cargo.toml`, `apps/desktop-companion/src-tauri/src/main.rs`, `apps/desktop-companion/src-tauri/src/commands.rs`, `apps/desktop-companion/src-tauri/src/updater.rs`
- Release automation: `.github/workflows/desktop-release.yml`, `.github/scripts/generate-update-manifest.sh`
- Platform signing docs: `docs/signing/macos-signing.md`, `docs/signing/windows-signing.md`
- Existing verification docs: `docs/verification/desktop-app-smoke-test.md`, `docs/verification/wp11-e2e-desktop-companion.md`, `docs/operations/runbook-006.md`

### Commands run

| Command | Result | Notes |
|---|---|---|
| `pnpm typecheck` | Pass | TypeScript compile succeeded on 2026-04-04 |
| `pnpm coverage` | Pass | 342 files, 5892 tests, 100% statements/branches/functions/lines |
| `pnpm --filter @joyus/desktop-companion build:sidecar` | Pass | `apps/desktop-companion/scripts/bundle-sidecar.mjs` executed successfully |
| `cargo test` in `apps/desktop-companion/src-tauri` | Blocked | `/bin/bash: cargo: command not found` on this audit host |

### Evidence not yet collected

- Local unsigned `cargo tauri build` proof on macOS
- Any Windows build proof from a Windows host or runner
- Signed artifact proof for either platform
- Clean-machine installer proof for either platform
- Live updater proof against a real release endpoint and real updater pubkey

## Core Signed RC Verdict

**Verdict:** `not ready; requires feature completion`

### Why

- Feature `004` is release-blocked:
  - packaging assets are incomplete
  - updater trust material is incomplete
  - autostart behavior is not implemented behind the settings command
  - uninstall cleanup behavior is not proven in code
- Feature `005` is still only partially proven for a signed RC:
  - `apps/desktop-companion/src/controlPlaneWiring.ts` still wires `requestDecision` to a placeholder rejection path
  - no live control-plane validation in a packaged desktop environment was found
- Core release prerequisites are unresolved blockers:
  - Apple signing/notarization credentials
  - Windows signing certificate
  - production updater signing keypair and published pubkey
  - release endpoint validation
- The current audit host cannot execute Rust/Tauri validation because `cargo` is missing.

### Go / No-Go

**No-Go** for a signed core desktop release today.

## Marketed RC Verdict

**Verdict:** `not ready; requires feature completion`

### Why

- Everything blocking the Core Signed RC also blocks the Marketed RC.
- Feature `007` is explicitly launch-blocking and is not desktop-ready:
  - the underlying packages exist (`packages/local-provisioner`, `packages/environment-monitor`)
  - the desktop app has only a view-model layer in `apps/desktop-companion/src/sitePanel.ts`
  - there is no routed site manager page, no onboarding integration, and no desktop proof of project discovery / provisioning / remote environment flows
- Feature `006` becomes partially launch-blocking because `007` depends on task-branch / PR / environment linking:
  - managed worktree flows and PR helpers exist
  - the end-to-end dependency slice from session -> PR -> preview environment -> site manager is not fully closed in the desktop app

### Go / No-Go

**No-Go** for a marketed launch that includes the site-manager promise.

## Prioritized Remediation Backlog

### P0

- Generate and commit required Tauri app/tray assets under `apps/desktop-companion/src-tauri/icons/`.
- Make the frontend build reproducible for Tauri builds. Either add `beforeBuildCommand` or enforce a documented/reliable prebuilt-frontend rule in the release path.
- Replace the placeholder updater pubkey in `apps/desktop-companion/src-tauri/tauri.conf.json` with the production public key.
- Provide and validate:
  - Apple Developer signing + notarization credentials
  - Windows Authenticode signing certificate
  - update manifest hosting endpoint
- Restore local or CI Rust/Tauri validation:
  - install Rust/Tauri tooling on the audit host, or
  - use CI runners as the authoritative signed-build proof lane
- Finish the missing `004` release-shell behaviors:
  - real autostart toggle behavior
  - uninstall cleanup mode and prompt
- Resolve the live-control-plane gap in `005`, or explicitly narrow the expected behavior if the placeholder token-refresh path is intentionally out of release scope.
- Finish enough of `007` and its `006` dependency slice to satisfy the launch promise if the marketed release is still the target.

### P1

- Run clean-machine macOS and Windows installer smoke tests using the checklist in `docs/verification/desktop-app-smoke-test.md`.
- Validate embedded binary signing for bundled Node + sidecar on macOS and Windows.
- Validate tray, reboot/autostart, updater banner/install path, and reinstall behavior.
- Reconcile rollout docs that still describe older desktop assumptions:
  - manual Node requirement
  - macOS-only desktop scope
  - missing auto-recovery assumptions

### P2

- Decide whether MSI support is needed beyond NSIS EXE.
- Finish the non-launch-critical portions of `006` and `008`.
- Expand post-launch health monitoring and release telemetry beyond the current smoke-test layer.

## Dependency Order

1. Packaging assets and reproducible build chain
2. Signing / updater prerequisites and release endpoint
3. Local Rust/Tauri validation lane
4. Desktop shell feature closure for `004`
5. Live control-plane closure for `005`
6. Launch-scope closure for `007` and the dependency-critical slice of `006`
7. Clean-machine installer validation on macOS and Windows

## Recommended Next Action

- If the goal is a **Core Signed RC**, close the `004` and `005` blockers first, then rerun the audit with Rust/Tauri build proof.
- If the goal is the **Marketed RC**, do not proceed to signing/release hardening until `007` and the required `006` slice are materially implemented in the desktop shell.
