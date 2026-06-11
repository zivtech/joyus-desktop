# Research: Desktop Application Shell

**Feature**: 004-desktop-application-shell
**Date**: 2026-03-14

## R1: Tauri v2 Sidecar Pattern

**Decision**: Use Tauri v2's `tauri-plugin-shell` sidecar feature to manage the Node.js backend process.

**Rationale**: Tauri v2 has first-class sidecar support. A sidecar is an external binary that Tauri manages as part of its lifecycle — starting it when the app launches, stopping it when the app quits. Communication happens over stdio, which maps directly to JSON-RPC 2.0.

**Configuration** (in `tauri.conf.json`):
```json
{
  "plugins": {
    "shell": {
      "sidecar": true
    }
  },
  "bundle": {
    "externalBin": [
      "binaries/node",
      "binaries/sidecar-main"
    ]
  }
}
```

**Key details**:
- Sidecar binaries must follow Tauri's naming convention: `<name>-<target_triple>` (e.g., `node-aarch64-apple-darwin`, `node-x86_64-pc-windows-msvc.exe`)
- The sidecar is spawned via Rust's `Command::new_sidecar("node")` which resolves the correct platform binary
- stdio is captured for JSON-RPC communication
- The sidecar process is killed on app shutdown

**Alternatives considered**:
- Embedded V8/QuickJS: Would require rewriting all packages to avoid Node.js APIs. Rejected.
- localhost HTTP server: Adds network dependency and port management. Rejected.
- Per-request Node.js invocation: Too slow (~200ms cold start per call). Rejected.

## R2: Tauri v2 + React + Vite Setup

**Decision**: Use Vite as the build tool with React + TypeScript for the dashboard frontend.

**Rationale**: Vite is Tauri's recommended build tool. It provides fast HMR in development and optimized builds for production. React is the confirmed frontend framework.

**Project scaffolding approach**:
- Add Tauri into the existing `apps/desktop-companion/` rather than scaffolding a new project
- `vite.config.ts` at the workspace member root
- `index.html` at the workspace member root (Vite entry point)
- React source in `src/ui/`

**Vite configuration**:
```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: ".",
  build: {
    outDir: "dist-ui",
  },
  server: {
    port: 1420,
    strictPort: true,
  },
});
```

**Tauri points to Vite**:
```json
{
  "build": {
    "devUrl": "http://localhost:1420",
    "frontendDist": "../dist-ui"
  }
}
```

## R3: Tauri v2 System Tray

**Decision**: Use `tauri::tray::TrayIconBuilder` for system tray with context menu.

**Rationale**: Tauri v2 replaced the v1 `SystemTray` API with a new `TrayIconBuilder` pattern that's more flexible and supports runtime updates.

**Key API**:
```rust
use tauri::tray::{TrayIconBuilder, MenuBuilder, MenuItemBuilder};

fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let menu = MenuBuilder::new(app)
        .text("open", "Open Dashboard")
        .text("sync", "Sync Now")
        .separator()
        .text("quit", "Quit")
        .build()?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "open" => { /* show main window */ }
                "sync" => { /* trigger sync via sidecar */ }
                "quit" => { app.exit(0); }
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}
```

**Details**:
- Tray icon can be updated dynamically (e.g., change color on error)
- Menu items can be enabled/disabled at runtime
- Tooltip text can show quick status

## R4: Tauri v2 Auto-Updater

**Decision**: Use `tauri-plugin-updater` with a self-hosted update manifest.

**Rationale**: Tauri v2 moved the updater to a plugin. It supports custom update endpoints, signature verification, and background downloads.

**Update manifest format** (hosted JSON):
```json
{
  "version": "1.2.0",
  "notes": "Bug fixes and performance improvements",
  "pub_date": "2026-03-14T00:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "<base64 signature>",
      "url": "https://releases.example.com/app-1.2.0-aarch64.dmg.tar.gz"
    },
    "darwin-x86_64": {
      "signature": "<base64 signature>",
      "url": "https://releases.example.com/app-1.2.0-x86_64.dmg.tar.gz"
    },
    "windows-x86_64": {
      "signature": "<base64 signature>",
      "url": "https://releases.example.com/app-1.2.0-x64-setup.nsis.zip"
    }
  }
}
```

**Configuration** (`tauri.conf.json`):
```json
{
  "plugins": {
    "updater": {
      "endpoints": ["https://releases.example.com/update/{{target}}/{{arch}}/{{current_version}}"],
      "pubkey": "<public key for signature verification>"
    }
  }
}
```

**Signing**: Updates are signed with a private key (`TAURI_SIGNING_PRIVATE_KEY`). The public key is embedded in the app binary. Tauri rejects updates with invalid signatures.

## R5: Cross-Platform CI (GitHub Actions)

**Decision**: GitHub Actions with matrix builds for macOS and Windows.

**Rationale**: GitHub Actions provides macOS and Windows runners, Tauri has official CI templates, and it integrates with the existing repository.

**Key workflow structure**:
- **Trigger**: On push to release branch or manual dispatch
- **Matrix**: `[macos-latest, windows-latest]`
- **Steps per platform**:
  1. Checkout + install Rust + install pnpm + install dependencies
  2. Run TypeScript tests (`pnpm test`)
  3. Run Rust tests (`cargo test`)
  4. Build Tauri app (`cargo tauri build`)
  5. Code sign (platform-specific)
  6. Upload artifacts to GitHub Releases
  7. Update the update manifest

**macOS signing + notarization**:
- Uses `apple-actions/import-codesign-certs` for certificate import
- Tauri handles notarization via `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` env vars

**Windows signing**:
- Authenticode signing via `signtool.exe` with certificate from GitHub secrets
- Tauri supports `WINDOWS_CERTIFICATE` and `WINDOWS_CERTIFICATE_PASSWORD` env vars

## R6: Bundling Node.js as Sidecar

**Decision**: Ship platform-specific Node.js binaries as Tauri sidecar resources.

**Rationale**: Users should not need to install Node.js. Bundling the runtime ensures consistent behavior and eliminates version conflicts.

**Approach**:
- Download official Node.js binaries for each target triple during CI
- Place them in `apps/desktop-companion/binaries/` following Tauri's naming convention:
  - `node-aarch64-apple-darwin` (macOS ARM)
  - `node-x86_64-apple-darwin` (macOS Intel)
  - `node-x86_64-pc-windows-msvc.exe` (Windows)
- The sidecar entry point (`src/sidecar/main.ts`) is bundled into a single JS file via esbuild
- Tauri launches: `node <bundled-sidecar-main.js>`

**Size impact**: Node.js binary is ~40 MB per platform. This is in addition to the ~10 MB Tauri binary. Total installed size: ~50-70 MB.

**Alternatives considered**:
- `pkg`/`nexe` (compile Node.js + JS into single binary): Rejected — breaks dynamic requires in MCP servers and adds complexity
- Detect system Node.js, fall back to bundled: Rejected — inconsistent behavior, version conflicts
- Bun as lighter runtime: Rejected — MCP servers may use Node.js-specific APIs

## R7: tauri-plugin-sql (SQLite)

**Decision**: Use `tauri-plugin-sql` for local SQLite storage.

**Rationale**: Provides a simple, type-safe SQLite interface from both Rust and the webview. Data stays local, no server needed.

**Configuration**:
```json
{
  "plugins": {
    "sql": {
      "preload": {
        "db": "sqlite:companion.db"
      }
    }
  }
}
```

**Usage from React** (via Tauri invoke):
```typescript
import Database from "@tauri-apps/plugin-sql";

const db = await Database.load("sqlite:companion.db");
const events = await db.select<UsageEvent[]>(
  "SELECT * FROM usage_events WHERE created_at > ? ORDER BY created_at DESC LIMIT ?",
  [since, limit]
);
```

**Migration strategy**: SQL migrations stored as `.sql` files in `src-tauri/migrations/`, applied on app startup before the dashboard loads.

**Alternatives considered**:
- JSON files: Rejected — no query capability, poor performance at scale
- IndexedDB in webview: Rejected — not accessible from Rust/sidecar
- better-sqlite3 in Node.js: Rejected — adds another SQLite instance, prefer single source of truth
