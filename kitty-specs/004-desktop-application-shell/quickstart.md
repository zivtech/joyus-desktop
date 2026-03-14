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

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `TAURI_SIGNING_PRIVATE_KEY` | Update signing key (CI only) | — |
| `APPLE_CERTIFICATE` | macOS code signing cert (CI only) | — |
| `APPLE_CERTIFICATE_PASSWORD` | macOS cert password (CI only) | — |
| `APPLE_ID` | Apple notarization account (CI only) | — |
| `APPLE_PASSWORD` | Apple app-specific password (CI only) | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID (CI only) | — |
| `WINDOWS_CERTIFICATE` | Windows Authenticode cert (CI only) | — |
| `WINDOWS_CERTIFICATE_PASSWORD` | Windows cert password (CI only) | — |
