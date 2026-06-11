# Implementation Plan: Desktop Application Shell

**Branch**: `004-desktop-application-shell` | **Date**: 2026-03-14 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/kitty-specs/004-desktop-application-shell/spec.md`

## Summary

Build an installable Tauri v2 desktop application for macOS and Windows that wraps the existing joyus-desktop TypeScript business logic into a native app with a React monitoring dashboard, system tray, auto-update, and MCP server lifecycle management. The app uses a managed Node.js sidecar to host existing packages and communicates via Tauri's event system.

## Technical Context

**Language/Version**: Rust (stable, for Tauri backend) + TypeScript 5.8+ strict (existing packages + React frontend)
**Primary Dependencies**: Tauri v2, React 19, Vite, tauri-plugin-shell (sidecar), tauri-plugin-sql (SQLite), tauri-plugin-updater, tauri-plugin-autostart
**Storage**: SQLite via tauri-plugin-sql for 30-day local usage data
**Testing**: Vitest (TS/React), cargo test (Rust), 100% coverage on TS modules
**Target Platform**: macOS (arm64 + x86_64) and Windows (x86_64) — shipping simultaneously
**Project Type**: Desktop application (Tauri + React monorepo workspace member)
**Performance Goals**: MCP servers available within 10s of startup, dashboard updates within 5s, <50 MB idle memory
**Constraints**: Binary <30 MB (excluding Node.js runtime), system Chrome for Playwright MCPs, single-instance enforcement
**Scale/Scope**: Internal tool for ~50 users across 2 orgs (Zivtech + Partner Org)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Status | Notes |
|------|--------|-------|
| TypeScript 5.8+ strict mode | PASS | All existing packages already comply. React frontend will use same tsconfig.base.json |
| ESM-only, Node.js 24 | PASS | Sidecar process runs existing ESM packages unchanged |
| pnpm workspaces | PASS | Tauri app lives in `apps/desktop-companion/`, already a workspace member |
| Vitest 100% coverage | PASS with exception | 100% coverage on all TS modules. Rust code tested via cargo test (not subject to Vitest threshold). React UI components tested via Vitest + testing-library |
| macOS + Windows | PASS | Tauri v2 supports both. CI produces both simultaneously |

**Exception**: Rust code in `src-tauri/` uses `cargo test`, not Vitest. This is standard for Tauri projects and does not violate the constitution's intent (all code is tested; the coverage tool differs by language).

## Project Structure

### Documentation (this feature)

```
kitty-specs/004-desktop-application-shell/
├── plan.md              # This file
├── research.md          # Phase 0: Tauri v2 patterns and best practices
├── data-model.md        # Phase 1: Local storage schema
├── quickstart.md        # Phase 1: Developer setup guide
├── contracts/           # Phase 1: IPC message contracts
└── tasks.md             # Phase 2 output (/spec-kitty.tasks)
```

### Source Code (repository root)

```
apps/desktop-companion/
├── package.json              # Updated: adds React, Vite, Tauri CLI deps
├── tsconfig.json             # Extends tsconfig.base.json
├── vite.config.ts            # Vite config for React frontend
├── index.html                # Vite entry point for React app
│
├── src/                      # Existing TypeScript business logic (UNCHANGED)
│   ├── authorization.ts
│   ├── handoffAuthorization.ts
│   ├── handoffOrchestrator.ts
│   ├── handoffUpload.ts
│   ├── runtimeExecution.ts
│   ├── runtimeOrchestrator.ts
│   ├── snapshotAssembly.ts
│   └── index.ts
│
├── src/ui/                   # NEW: React dashboard frontend
│   ├── main.tsx              # React entry point
│   ├── App.tsx               # Root component with routing
│   ├── components/           # Shared UI components
│   │   ├── StatusBadge.tsx
│   │   ├── ServerCard.tsx
│   │   └── SkillList.tsx
│   ├── pages/                # Dashboard pages
│   │   ├── Dashboard.tsx     # Main overview: servers, skills, sync
│   │   ├── Servers.tsx       # MCP server detail view
│   │   ├── Skills.tsx        # Skill list and versions
│   │   ├── Governance.tsx    # Governance mode and decisions
│   │   ├── Usage.tsx         # Usage patterns (30-day local data)
│   │   ├── Settings.tsx      # App settings, sync trigger, about
│   │   └── Onboarding.tsx    # First-run setup wizard
│   ├── hooks/                # React hooks for Tauri IPC
│   │   ├── useTauriEvent.ts  # Subscribe to Tauri events
│   │   ├── useServerStatus.ts
│   │   ├── useSyncStatus.ts
│   │   └── useGovernance.ts
│   └── lib/                  # Frontend utilities
│       ├── ipc.ts            # Tauri invoke wrappers
│       └── types.ts          # Shared frontend types
│
├── src/sidecar/              # NEW: Node.js sidecar entry point
│   ├── main.ts               # Sidecar bootstrap: starts services, listens for IPC
│   ├── services.ts           # Wires up mcp-registry, desktop-sync, governance
│   ├── ipc-handler.ts        # Handles Tauri event messages
│   └── usage-collector.ts    # Collects usage data for local SQLite
│
├── src-tauri/                # NEW: Tauri Rust backend
│   ├── Cargo.toml            # Rust dependencies
│   ├── tauri.conf.json       # Tauri configuration (window, tray, sidecar, updater)
│   ├── build.rs              # Tauri build script
│   ├── src/
│   │   ├── main.rs           # Tauri entry point
│   │   ├── tray.rs           # System tray setup and event handling
│   │   ├── commands.rs       # Tauri commands (invoke handlers)
│   │   ├── sidecar.rs        # Sidecar lifecycle management
│   │   ├── updater.rs        # Auto-update configuration
│   │   └── lib.rs            # Module exports
│   └── icons/                # App icons for both platforms
│
├── test/                     # Existing tests (UNCHANGED) + new tests
│   ├── *.test.ts             # Existing business logic tests
│   ├── sidecar/              # NEW: sidecar integration tests
│   │   ├── ipc-handler.test.ts
│   │   ├── services.test.ts
│   │   └── usage-collector.test.ts
│   └── ui/                   # NEW: React component tests
│       ├── Dashboard.test.tsx
│       ├── Onboarding.test.tsx
│       └── hooks/
│
└── binaries/                 # NEW: Bundled sidecar binaries (gitignored, built by CI)
    ├── node-x86_64-apple-darwin
    ├── node-aarch64-apple-darwin
    └── node-x86_64-pc-windows-msvc.exe
```

**Structure Decision**: The Tauri app is added directly into `apps/desktop-companion/`, keeping all desktop companion code in one workspace member. The existing `src/` business logic is untouched. New directories: `src/ui/` (React), `src/sidecar/` (Node.js entry point), `src-tauri/` (Rust). This avoids creating a separate app that imports desktop-companion and keeps the workspace flat.

## Architecture

### IPC Communication Flow

```
┌──────────────────────────────────────────────┐
│                   User                        │
│              (clicks, views)                  │
└──────────────────┬───────────────────────────┘
                   │
┌──────────────────▼───────────────────────────┐
│           React Dashboard (webview)           │
│  invoke("get_servers") ←→ listen("state:update") │
└──────────────────┬───────────────────────────┘
                   │ Tauri IPC (webview ↔ Rust)
┌──────────────────▼───────────────────────────┐
│            Tauri Rust Backend                  │
│  • System tray                                │
│  • Window management                          │
│  • Auto-update                                │
│  • Sidecar lifecycle                          │
│  • Platform-native: autostart, single-instance│
└──────────────────┬───────────────────────────┘
                   │ stdio JSON-RPC (Rust ↔ Node.js)
┌──────────────────▼───────────────────────────┐
│          Node.js Sidecar Process              │
│  • mcp-registry (server lifecycle, watchdog)  │
│  • desktop-sync (skill sync, version pin)     │
│  • mcp-governance (mode enforcement, telemetry)│
│  • policy-client (authorization)              │
│  • session-agent (runtime routing)            │
│  • usage-collector (local telemetry → SQLite) │
└───────────────────────────────────────────────┘
         │                    │
    ┌────▼────┐         ┌────▼────┐
    │ MCP     │   ...   │ MCP     │
    │ Server 1│         │ Server N│
    └─────────┘         └─────────┘
```

### Sidecar Communication Protocol

The Rust backend and Node.js sidecar communicate via **JSON-RPC 2.0 over stdio**:

- **Rust → Node.js**: Request/response for queries (get server status, get skills, trigger sync)
- **Node.js → Rust**: Notifications for state changes (server crashed, sync completed, governance decision)
- Tauri Rust backend relays these as Tauri events to the React frontend

### Data Flow for Dashboard

1. React component calls `invoke("get_servers")` (Tauri command)
2. Rust handler sends JSON-RPC request to sidecar via stdio
3. Sidecar queries mcp-registry, returns server list
4. Rust handler returns response to React
5. For real-time updates: sidecar emits JSON-RPC notifications → Rust converts to Tauri events → React listens via `listen("state:update")`

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Rust code (new language) | Tauri requires Rust for native shell | Electron rejected for binary size; Tauri's Rust layer is thin (tray, window, sidecar management) |
| cargo test (not Vitest) | Rust tests use Rust toolchain | Cannot run Rust tests in Vitest; coverage tracked separately |
| Bundled Node.js binary (~40 MB) | MCP servers require Node.js runtime | Compiling TS to standalone binaries (pkg/nexe) rejected: breaks dynamic require patterns in MCP servers and adds build complexity |
