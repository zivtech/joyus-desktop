# Quickstart: Desktop Application Shell Development

**Feature**: 004-desktop-application-shell

## Prerequisites

- **Rust** (stable toolchain): `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- **Node.js 24**: Already required by the monorepo
- **pnpm 10.5**: Already required by the monorepo
- **Tauri CLI**: Installed via `cargo install tauri-cli@^2`
- **Platform-specific**:
  - macOS: Xcode Command Line Tools (`xcode-select --install`)
  - Windows: Visual Studio Build Tools with C++ workload, WebView2 (pre-installed on Windows 11)

## Setup

```bash
# From repository root
pnpm install

# Install Tauri CLI
cargo install tauri-cli@^2

# Verify Tauri prerequisites
cargo tauri info
```

## Development

```bash
# Start Tauri dev mode (hot-reload for React, rebuilds Rust on change)
cd apps/desktop-companion
cargo tauri dev

# This starts:
# 1. Vite dev server for React frontend
# 2. Tauri Rust backend in debug mode
# 3. Node.js sidecar process
```

## Build

```bash
# Development build (unsigned)
cargo tauri build --debug

# Release build (for CI — requires signing keys)
cargo tauri build
```

## Testing

```bash
# TypeScript tests (business logic + sidecar + React components)
pnpm test

# Rust tests
cd apps/desktop-companion/src-tauri
cargo test

# Full CI check
pnpm run ci
```

## Project Layout

| Directory | What | When to edit |
|-----------|------|-------------|
| `src/` | Existing TS business logic | Only if business logic needs changes |
| `src/ui/` | React dashboard frontend | When changing the UI |
| `src/sidecar/` | Node.js sidecar entry point | When changing IPC handlers or service wiring |
| `src-tauri/src/` | Rust backend | When changing tray, window, updater, or sidecar management |
| `test/` | All TS tests | When adding/changing TS code |
| `src-tauri/` | Rust project root | When changing Tauri config or Rust deps |

## Key Files

- `src-tauri/tauri.conf.json` — Tauri configuration (window size, tray, sidecar path, updater endpoint, bundle identifiers)
- `src-tauri/Cargo.toml` — Rust dependencies (tauri, tauri-plugin-*)
- `vite.config.ts` — Vite config for React frontend build
- `src/sidecar/main.ts` — Sidecar entry point (bootstraps all services)
- `src/ui/main.tsx` — React entry point

## Update Signing Keys

The auto-updater requires an Ed25519 keypair. The public key is embedded in `tauri.conf.json`; the private key lives only in CI secrets.

### Generate a keypair

```bash
cargo tauri signer generate -w ~/.tauri/joyus-desktop.key
```

This prints the public key to stdout and writes the private key to `~/.tauri/joyus-desktop.key`.

### Wire up the keys

1. Copy the printed public key into `tauri.conf.json` under `plugins.updater.pubkey`.
2. Add the private key as a CI secret named `TAURI_SIGNING_PRIVATE_KEY`.
3. Set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in CI if you chose a passphrase (leave empty otherwise).

### Key rotation procedure

Key rotation requires a two-phase release to avoid bricking existing installs:

1. Generate a new keypair.
2. Release a **transition version** that trusts both the old and the new public key (add both keys in `tauri.conf.json` as an array).
3. Once all users have updated past the transition version, remove the old key and release a follow-up version.
4. Revoke / delete the old private key from CI secrets.

### Never do this

- Do not commit the private key file to the repository.
- Do not share the private key outside CI secrets.
- Do not reuse the same key across different Tauri applications.

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `TAURI_SIGNING_PRIVATE_KEY` | Update signing key (CI only) | — |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Passphrase for signing key (CI only, empty if none) | — |
| `APPLE_CERTIFICATE` | macOS code signing cert (CI only) | — |
| `APPLE_CERTIFICATE_PASSWORD` | macOS cert password (CI only) | — |
| `APPLE_ID` | Apple notarization account (CI only) | — |
| `APPLE_PASSWORD` | Apple app-specific password (CI only) | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID (CI only) | — |
| `WINDOWS_CERTIFICATE` | Windows Authenticode cert (CI only) | — |
| `WINDOWS_CERTIFICATE_PASSWORD` | Windows cert password (CI only) | — |
