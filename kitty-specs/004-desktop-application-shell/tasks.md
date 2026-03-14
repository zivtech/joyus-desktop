# Work Packages: Desktop Application Shell

**Total**: 15 work packages
**Subtasks**: 67 (T001–T067)

## Dependency Graph

```
Layer 0: WP01 (scaffold)                                        [no deps]
Layer 1: WP02 (sidecar bootstrap)                               [depends on WP01]
Layer 2: WP03 (Rust sidecar lifecycle)                           [depends on WP02]
Layer 3: WP04, WP05, WP06, WP07, WP12                           [all depend on WP03, parallel]
Layer 4: WP08 (dashboard layout + hooks)                         [depends on WP04, WP05]
Layer 5: WP09, WP10, WP11                                       [all depend on WP08, parallel]
Layer 6: WP13 (packaging + signing)                              [depends on WP07, WP12]
Layer 7: WP14 (CI/CD)                                            [depends on WP13]
Layer 8: WP15 (integration testing)                              [depends on WP09–WP11, WP13]
```

## Parallelization Opportunities

- **Layer 3**: WP04 + WP05 + WP06 + WP07 + WP12 can all run simultaneously (5-way parallel)
- **Layer 5**: WP09 + WP10 + WP11 can run simultaneously (3-way parallel)
- **Maximum parallelism**: 5 agents at Layer 3

---

## Layer 0 — Foundation

### WP01 — Tauri Project Scaffold
**Prompt**: [`tasks/WP01-tauri-scaffold.md`](tasks/WP01-tauri-scaffold.md)
**Dependencies**: none
**Subtasks**: T001–T005 (5 subtasks, ~350 lines)

- [x] T001: Initialize Tauri v2 project in apps/desktop-companion (Cargo.toml, tauri.conf.json, build.rs, main.rs)
- [x] T002: Configure Vite + React frontend (vite.config.ts, index.html, main.tsx, App.tsx skeleton)
- [x] T003: Set up SQLite via tauri-plugin-sql (database schema, migrations, plugin config)
- [x] T004: Update workspace configuration (package.json new deps, tsconfig adjustments for React)
- [x] T005: Configure single-instance enforcement (tauri-plugin-single-instance)

---

## Layer 1 — Sidecar Foundation

### WP02 — Node.js Sidecar Bootstrap
**Prompt**: [`tasks/WP02-sidecar-bootstrap.md`](tasks/WP02-sidecar-bootstrap.md)
**Dependencies**: WP01
**Subtasks**: T006–T011 (6 subtasks, ~450 lines)

- [x] T006: Create sidecar entry point (src/sidecar/main.ts) with stdio JSON-RPC listener
- [x] T007: Implement JSON-RPC 2.0 protocol handler (request parsing, method dispatch, error responses)
- [x] T008: Wire up existing services in sidecar (mcp-registry, desktop-sync, mcp-governance)
- [x] T009: Bundle sidecar with esbuild into single JS file
- [x] T010: Script to download platform-specific Node.js binaries for sidecar
- [x] T011: Configure Tauri externalBin for Node.js + bundled sidecar

---

## Layer 2 — Rust Backend Core

### WP03 — Rust Sidecar Lifecycle & Event Bridge
**Prompt**: [`tasks/WP03-rust-sidecar-lifecycle.md`](tasks/WP03-rust-sidecar-lifecycle.md)
**Dependencies**: WP02
**Subtasks**: T012–T016 (5 subtasks, ~400 lines)

- [x] T012: Implement sidecar spawn and process monitoring in Rust
- [x] T013: Implement graceful shutdown (SIGTERM with 5s timeout → SIGKILL fallback)
- [x] T014: Implement Tauri event bridge (sidecar JSON-RPC notifications → Tauri events → frontend)
- [x] T015: Implement Tauri commands that proxy requests to sidecar via JSON-RPC
- [x] T016: Orphaned process cleanup on startup via PID file

---

## Layer 3 — IPC Methods & Platform Features (parallel)

### WP04 — Server Management IPC
**Prompt**: [`tasks/WP04-server-management-ipc.md`](tasks/WP04-server-management-ipc.md)
**Dependencies**: WP03
**Subtasks**: T017–T020 (4 subtasks, ~350 lines)

- [ ] T017: Implement servers.list, servers.start, servers.stop, servers.restart in sidecar
- [ ] T018: Implement state.serverChanged notifications from mcp-registry events
- [ ] T019: Implement health.check and chrome.detect methods
- [ ] T020: Tests for server management IPC methods (100% coverage)

### WP05 — Sync, Skills & Governance IPC
**Prompt**: [`tasks/WP05-sync-skills-governance-ipc.md`](tasks/WP05-sync-skills-governance-ipc.md)
**Dependencies**: WP03
**Subtasks**: T021–T025 (5 subtasks, ~400 lines)

- [ ] T021: Implement sync.trigger, sync.status, skills.list in sidecar
- [ ] T022: Implement governance.getMode, governance.getDecisions in sidecar
- [ ] T023: Implement state.syncCompleted and state.governanceDecision notifications
- [ ] T024: Implement state.error notifications for crash reporting via telemetry
- [ ] T025: Tests for sync/skills/governance IPC methods (100% coverage)

### WP06 — Usage Data Collection & Storage
**Prompt**: [`tasks/WP06-usage-data-collection.md`](tasks/WP06-usage-data-collection.md)
**Dependencies**: WP03
**Subtasks**: T026–T030 (5 subtasks, ~400 lines)

- [ ] T026: Implement usage-collector.ts (event aggregation, writes to SQLite via Tauri command)
- [ ] T027: Implement usage.query and usage.summary IPC methods
- [ ] T028: Implement 30-day data pruning (on startup + every 24 hours)
- [ ] T029: Implement onboarding.start IPC method (auth, MCP config, sync)
- [ ] T030: Tests for usage collector, pruning, and onboarding IPC (100% coverage)

### WP07 — System Tray & Platform Integration
**Prompt**: [`tasks/WP07-system-tray-platform.md`](tasks/WP07-system-tray-platform.md)
**Dependencies**: WP03
**Subtasks**: T031–T034 (4 subtasks, ~300 lines)

- [x] T031: Implement system tray icon with context menu (open dashboard, sync now, quit)
- [x] T032: Configure auto-start on login (tauri-plugin-autostart, macOS + Windows)
- [x] T033: Implement tray icon dynamic status updates (normal/warning/error states)
- [x] T034: Implement app-level crash reporting via existing telemetry pipeline

### WP12 — Auto-Update
**Prompt**: [`tasks/WP12-auto-update.md`](tasks/WP12-auto-update.md)
**Dependencies**: WP03
**Subtasks**: T049–T052 (4 subtasks, ~300 lines)

- [ ] T049: Configure tauri-plugin-updater (endpoint URL, public key, check interval)
- [ ] T050: Implement update check, download, signature verification, and restart flow
- [ ] T051: Add update notification in dashboard UI (banner or modal with restart option)
- [ ] T052: Generate Tauri signing keypair and document key management

---

## Layer 4 — Dashboard Foundation

### WP08 — Dashboard Layout & IPC Hooks
**Prompt**: [`tasks/WP08-dashboard-layout-hooks.md`](tasks/WP08-dashboard-layout-hooks.md)
**Dependencies**: WP04, WP05
**Subtasks**: T035–T038 (4 subtasks, ~450 lines)

- [ ] T035: Create dashboard layout (sidebar navigation, main content area, status bar)
- [ ] T036: Create React hooks for Tauri IPC (useTauriEvent, useServerStatus, useSyncStatus, useGovernance)
- [ ] T037: Build Dashboard overview page (server health cards, skill count, sync status, quick stats)
- [ ] T038: Create shared UI components (StatusBadge, ServerCard, SkillList)

---

## Layer 5 — Dashboard Pages (parallel)

### WP09 — Server & Skills Pages
**Prompt**: [`tasks/WP09-server-skills-pages.md`](tasks/WP09-server-skills-pages.md)
**Dependencies**: WP08
**Subtasks**: T039–T041 (3 subtasks, ~350 lines)

- [ ] T039: Build Servers page (server list, status badges, start/stop/restart controls, error display)
- [ ] T040: Build Skills page (skill list with versions, bundle info, last sync timestamp)
- [ ] T041: Wire server action buttons to Tauri commands (start/stop/restart with optimistic UI)

### WP10 — Governance, Usage & Settings Pages
**Prompt**: [`tasks/WP10-governance-usage-settings.md`](tasks/WP10-governance-usage-settings.md)
**Dependencies**: WP08, WP06
**Subtasks**: T042–T044 (3 subtasks, ~400 lines)

- [ ] T042: Build Governance page (mode indicator, recent decisions table with filtering)
- [ ] T043: Build Usage page (30-day activity chart, top tools ranking, daily counts)
- [ ] T044: Build Settings page (auto-start toggle, telemetry opt-out, sync trigger, about)

### WP11 — Onboarding Wizard
**Prompt**: [`tasks/WP11-onboarding-wizard.md`](tasks/WP11-onboarding-wizard.md)
**Dependencies**: WP08, WP06
**Subtasks**: T045–T048 (4 subtasks, ~350 lines)

- [ ] T045: Build Onboarding wizard UI (multi-step: auth → MCP config → sync → completion)
- [ ] T046: Implement first-run detection and automatic onboarding trigger
- [ ] T047: Wire onboarding steps to sidecar IPC (onboarding.start method)
- [ ] T048: Handle onboarding errors (retry per step, partial progress preservation)

---

## Layer 6 — Packaging

### WP13 — Packaging, Signing & Icons
**Prompt**: [`tasks/WP13-packaging-signing.md`](tasks/WP13-packaging-signing.md)
**Dependencies**: WP07, WP12
**Subtasks**: T053–T057 (5 subtasks, ~350 lines)

- [ ] T053: Configure Tauri bundle settings (app name, identifier, category, description)
- [ ] T054: Create app icons for both platforms (tray icon variants, app icon, installer branding)
- [ ] T055: Set up macOS code signing and notarization configuration
- [ ] T056: Set up Windows Authenticode signing configuration
- [ ] T057: Implement uninstall cleanup prompt (full cleanup vs app-only removal)

---

## Layer 7 — CI/CD

### WP14 — CI/CD Pipeline
**Prompt**: [`tasks/WP14-cicd-pipeline.md`](tasks/WP14-cicd-pipeline.md)
**Dependencies**: WP13
**Subtasks**: T058–T062 (5 subtasks, ~400 lines)

- [ ] T058: Create GitHub Actions workflow with macOS + Windows build matrix
- [ ] T059: Add code signing secrets management and certificate import steps
- [ ] T060: Add Node.js binary download and sidecar bundling to CI build
- [ ] T061: Produce .dmg (macOS) and .exe/MSI (Windows) release artifacts
- [ ] T062: Add update manifest generation and upload step to release workflow

---

## Layer 8 — Integration & Verification

### WP15 — Integration Testing & Polish
**Prompt**: [`tasks/WP15-integration-testing.md`](tasks/WP15-integration-testing.md)
**Dependencies**: WP09, WP10, WP11, WP13
**Subtasks**: T063–T067 (5 subtasks, ~350 lines)

- [ ] T063: Integration test: sidecar launch → IPC round-trip → graceful shutdown
- [ ] T064: Integration test: onboarding flow end-to-end (mock auth → MCP config → sync)
- [ ] T065: Verify dashboard real-time updates (server crash → UI update within 5 seconds)
- [ ] T066: Cross-platform smoke test checklist (install, launch, tray, dashboard, quit on both OSes)
- [ ] T067: Performance validation (startup <10s to MCP ready, memory <50 MB idle, sync <15s warm)
