# Platform Gap Matrix

Audit date: 2026-04-04

| Platform | Area | Symptom | Root cause | Severity | Owner type | External dependency | Validation step | Current status |
|---|---|---|---|---|---|---|---|---|
| Both | Frontend build chain | Clean Tauri builds cannot be proven reproducible from repo state alone | `apps/desktop-companion/src-tauri/tauri.conf.json` references `../dist` but does not declare `beforeBuildCommand` | P0 | app | None | Run `cargo tauri build` from a clean clone and verify frontend assets exist before packaging | Open |
| Both | App + tray assets | No generated app icons or tray icons are present | `apps/desktop-companion/src-tauri/icons/` contains only `README.md` | P0 | design / app | Source 1024px icon artwork | Generate icons, inspect bundle contents, and verify tray icon rendering on macOS/Windows | Open |
| Both | Updater trust | Production updater verification cannot work with the current config | `apps/desktop-companion/src-tauri/tauri.conf.json` still has `"<TAURI_UPDATE_PUBLIC_KEY>"` | P0 | release / ops | Updater signing keypair and production pubkey | Run update check/install against a signed manifest and verify signature acceptance | Open |
| Both | Update endpoint | Release endpoint is configured but unverified | Updater points at `https://releases.joyus.dev/...`; no proof of live manifest hosting was found in this audit | P0 | ops | Hosted release/update-manifest endpoint | Fetch update manifest and complete an updater smoke test | Open |
| Both | Bundled runtime proof | End-to-end packaged runtime proof is incomplete | Sidecar bundling passed, but bundled Node runtime download/install proof and installed-app sidecar spawn proof were not completed in this audit | P0 | app / release | Node download availability or prebuilt binary hosting | Run `download:node`, build the app, install, and verify sidecar/MCP startup | Open |
| Both | Uninstall cleanup | Required uninstall choice and cleanup behavior is not proven | No app-shell or installer implementation matching feature `004` FR-020 was found | P1 | app / release | None | Install, uninstall, and verify both app-only removal and full cleanup behavior | Open |
| Both | Autostart toggle | Settings UI can report success without changing platform startup state | `apps/desktop-companion/src-tauri/src/commands.rs` implements `toggle_autostart()` as a no-op | P1 | app | None | Toggle autostart from UI, reboot, and verify actual startup behavior | Open |
| macOS | Signing + notarization | No signed/notarized macOS artifact proof exists in this audit | Workflow and docs exist, but local build/test could not run and no notarized artifact evidence was collected | P0 | release / ops | Apple Developer account, Developer ID cert, notarization credentials | `codesign --verify`, `spctl --assess`, notarization + stapling proof on a built app | Blocked |
| macOS | Embedded binary signing | Bundled Node + sidecar signing is unproven | macOS release workflow expects embedded binaries, but no signed bundle was available to inspect | P0 | release | Apple signing credentials | Verify the final `.app` with deep signing checks and inspect embedded binaries | Blocked |
| macOS | LaunchAgent behavior | Auto-start on login is configured but not verified | `tauri_plugin_autostart` is enabled with `MacosLauncher::LaunchAgent`, but behavior is not proven in installer smoke | P1 | app / release | macOS validation machine | Install, enable autostart, reboot, and verify tray + dashboard state | Open |
| Windows | Authenticode signing | No signed Windows installer proof exists in this audit | Workflow and docs exist, but no Windows build or signature validation evidence was collected | P0 | release / ops | Windows signing certificate | Build on Windows and verify with `Get-AuthenticodeSignature` | Blocked |
| Windows | SmartScreen trust | First-launch trust is uncertain even if signing is added | Docs recommend EV signing for immediate reputation, but no EV/OV decision is locked in repo evidence | P1 | ops / product | EV certificate or SmartScreen reputation plan | Fresh-VM install test with release candidate | Open |
| Windows | Startup registration | Startup behavior is unproven and UI toggle is still a no-op | Autostart plugin is present, but there is no verified Windows startup registration path from the UI | P1 | app / release | Windows validation machine | Enable startup, reboot, and verify launch state on Windows | Open |
| Windows | Installer format | MSI is not produced | `tauri.conf.json` targets `nsis`; no MSI path is configured | P2 | release / product | Stakeholder confirmation if MSI becomes required | Confirm NSIS-only acceptance for v1 | Accepted for v1 |
| Both | Release toolchain on audit host | Local Rust/Tauri validation could not be completed on this machine | `cargo test` failed with `/bin/bash: cargo: command not found` | P0 | dev env / release | Rust toolchain + Tauri CLI on audit machine or CI runner access | Install Rust locally or move authoritative build proof to CI | Blocked |

## Immediate P0 Set

- Frontend build chain
- App + tray assets
- Updater trust material
- Update endpoint proof
- Bundled runtime proof
- macOS signing/notarization
- Windows signing
- Rust/Tauri validation lane
