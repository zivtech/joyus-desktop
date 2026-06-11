# Feature Specification: Desktop Application Shell

**Feature Branch**: `004-desktop-application-shell`
**Created**: 2026-03-14
**Status**: Draft
**Input**: Wrap existing joyus-desktop business logic into an installable Tauri desktop application for macOS and Windows with monitoring dashboard, system tray, auto-update, and MCP server management.

## Scope

### In Scope

- Tauri application shell with Rust backend and web-based frontend.
- Native packaging: `.dmg` for macOS, `.exe`/MSI installer for Windows — both platforms ship simultaneously.
- Code signing and notarization for macOS (Apple Developer ID) and Windows (Authenticode).
- Auto-update mechanism using Tauri's built-in updater with a self-hosted update manifest.
- System tray icon with context menu for quick status and controls.
- Dashboard window showing: available skills, MCP server health, usage patterns, governance mode, and sync status.
- First-run onboarding flow that configures the user's environment.
- Auto-start on login (launchd on macOS, registry/startup folder on Windows).
- Background service managing MCP server processes via the existing `mcp-registry` package.
- Bundled Node.js runtime so users do not need Node.js pre-installed.
- IPC bridge between Tauri (Rust) shell and existing TypeScript business logic packages.
- Browser-based MCPs (axe-core, lighthouse, screenshot) delegate to system-installed Chrome via Playwright.
- Integration with existing packages: `policy-client`, `session-agent`, `desktop-sync`, `mcp-registry`, `mcp-governance`.

### Out of Scope

- Linux packaging (may follow later but not part of this feature).
- Mobile applications (iOS/Android).
- Server-side control plane changes (belongs to `joyus-ai`).
- New business logic — this feature wraps existing logic, it does not add policy rules, handoff flows, or governance modes.
- Hosted MCP relay for browser-dependent tools (separate feature if needed).
- Claude Code IDE integration changes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Install and Launch the Desktop Companion (Priority: P1)

A user downloads the desktop companion for their platform, installs it, and sees the app running in their system tray.

**Why this priority**: Without a working installer and launch flow, nothing else in this feature matters.

**Independent Test**: Automated build pipeline produces signed installers for both platforms; manual verification confirms install, launch, and tray icon appearance.

**Acceptance Scenarios**:

1. **Given** a macOS user downloads the `.dmg`, **When** they drag the app to Applications and launch it, **Then** the app starts, shows a system tray icon, and displays the onboarding flow.
2. **Given** a Windows user runs the `.exe` installer, **When** installation completes, **Then** the app starts, shows a system tray icon, and displays the onboarding flow.
3. **Given** the app is installed, **When** the user restarts their computer, **Then** the app auto-starts and the tray icon is visible without manual launch.
4. **Given** the app is running, **When** the user clicks the tray icon, **Then** a context menu appears with options to open the dashboard, trigger sync, and quit.

---

### User Story 2 — First-Run Onboarding (Priority: P1)

A new user installs the companion and is guided through initial setup so that skills, MCPs, and sync are configured without manual steps.

**Why this priority**: Zero-friction onboarding is critical for non-developer adoption.

**Independent Test**: End-to-end test simulates first launch and verifies all onboarding steps complete successfully.

**Acceptance Scenarios**:

1. **Given** the app launches for the first time, **When** the onboarding flow starts, **Then** the user is prompted to authenticate with their organization credentials.
2. **Given** authentication succeeds, **When** onboarding continues, **Then** the app configures Claude Code's `.mcp.json` with managed MCP server entries.
3. **Given** MCP configuration completes, **When** onboarding continues, **Then** skill sync runs and downloads the user's assigned skill bundle.
4. **Given** all setup steps complete, **When** the onboarding flow finishes, **Then** the dashboard opens showing healthy MCP servers and synced skills.
5. **Given** any setup step fails (network error, auth failure), **When** the error occurs, **Then** the user sees a clear error message with a retry option, and partial progress is preserved.

---

### User Story 3 — Monitor System Health via Dashboard (Priority: P1)

A user opens the dashboard to check the status of their skills, MCP servers, and sync state.

**Why this priority**: Visibility into system health is the primary ongoing value of the desktop UI.

**Independent Test**: Unit and integration tests verify dashboard data binding to underlying service state.

**Acceptance Scenarios**:

1. **Given** the dashboard is open, **When** MCP servers are running, **Then** the dashboard shows each server's name, status (running/stopped/error), and uptime.
2. **Given** the dashboard is open, **When** skills have been synced, **Then** the dashboard shows the list of available skills, their versions, and last sync time.
3. **Given** the dashboard is open, **When** governance mode is active, **Then** the dashboard shows the current mode (off/audit/enforce) and recent governance decisions.
4. **Given** an MCP server crashes, **When** the dashboard is visible, **Then** the status updates to "error" within 5 seconds and the user can restart the server from the dashboard.
5. **Given** the dashboard is open, **When** the user views usage patterns, **Then** the dashboard shows tool call activity and invocation counts from the last 30 days, stored locally on the user's machine.

---

### User Story 4 — MCP Server Lifecycle Management (Priority: P1)

The app manages MCP server processes in the background, starting them on launch and keeping them healthy.

**Why this priority**: MCP servers are the core runtime dependency — if they don't run, local tools don't work.

**Independent Test**: Integration tests verify process spawn, watchdog restart, and clean shutdown.

**Acceptance Scenarios**:

1. **Given** the app starts, **When** MCP servers are registered, **Then** all enabled servers are spawned using the bundled Node.js runtime.
2. **Given** an MCP server process crashes, **When** the watchdog detects it, **Then** the server is automatically restarted with exponential backoff (max 5 restarts).
3. **Given** the user quits the app, **When** shutdown begins, **Then** all MCP server processes are gracefully terminated with SIGTERM, falling back to SIGKILL after 5 seconds.
4. **Given** the app was force-killed (crash, power loss), **When** the app next starts, **Then** orphaned MCP server processes are detected via PID file and cleaned up.
5. **Given** MCP servers are running, **When** Claude Code makes a tool call, **Then** the local MCP server responds via stdio transport.

---

### User Story 5 — Auto-Update (Priority: P2)

The app checks for updates and applies them without user intervention.

**Why this priority**: Users must stay on current versions for security and compatibility, but this can ship shortly after initial release.

**Independent Test**: Mock update server returns a new version; app downloads, verifies signature, and prompts for restart.

**Acceptance Scenarios**:

1. **Given** the app is running, **When** a new version is available on the update server, **Then** the app downloads the update in the background.
2. **Given** an update is downloaded, **When** the download completes and signature is verified, **Then** the user is notified with an option to restart now or later.
3. **Given** the user chooses to restart, **When** the restart occurs, **Then** the new version launches and all MCP servers are re-started.
4. **Given** the update signature verification fails, **When** the check completes, **Then** the update is discarded, the user is not prompted, and an error is logged.
5. **Given** the user is offline, **When** update check fails, **Then** the app continues running the current version without error.

---

### User Story 6 — Skill Sync and Version Pin (Priority: P1)

The app keeps skills up to date by syncing from the distribution repository, respecting admin-configured version pins.

**Why this priority**: Skill freshness is a core value proposition of the desktop companion.

**Independent Test**: Integration tests verify sync on startup, periodic sync, and version pin changes.

**Acceptance Scenarios**:

1. **Given** the app starts, **When** startup sync runs, **Then** skills are synced to the pinned version from the distribution config.
2. **Given** the app is running, **When** the admin changes the pinned version, **Then** the next periodic sync picks up the new version and updates skills.
3. **Given** the network is unavailable, **When** sync fails, **Then** the app uses the last successfully synced skills and logs the failure.
4. **Given** skills are synced, **When** the user views the dashboard, **Then** the current skill version and last sync timestamp are displayed.

---

### Edge Cases

- Installer run without administrator privileges on Windows.
- macOS Gatekeeper blocks unsigned or improperly notarized builds.
- System Chrome is not installed (Playwright browser MCPs unavailable — dashboard should indicate this clearly).
- Multiple instances of the app launched simultaneously (must enforce single-instance).
- Disk full during update download or skill sync.
- User manually edits `.mcp.json` and removes managed entries — next launch should re-add them.
- Firewall blocks update server or sync repository.
- Node.js bundled version conflicts with user's globally installed Node.js.
- App launched while a previous version's MCP processes are still running.
- Uninstall while MCP servers are still running — must terminate processes before removing files.
- App crash during onboarding — partial state must not leave the system in an inconsistent configuration.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The application MUST be built with Tauri, producing native binaries for macOS (`.dmg`) and Windows (`.exe`/MSI).
- **FR-002**: The application MUST be code-signed (Apple Developer ID for macOS, Authenticode for Windows) and notarized for macOS.
- **FR-003**: The application MUST auto-start on login via platform-native mechanisms (launchd on macOS, startup registry on Windows).
- **FR-004**: The application MUST enforce single-instance execution — launching a second instance activates the existing one.
- **FR-005**: The application MUST display a system tray icon with a context menu providing: open dashboard, trigger sync, and quit.
- **FR-006**: The application MUST provide a dashboard window showing MCP server status, available skills, governance mode, sync state, and usage patterns (last 30 days, stored locally).
- **FR-007**: The dashboard MUST update in near-real-time (within 5 seconds) when underlying state changes.
- **FR-008**: The application MUST manage MCP server processes: spawn on startup, watchdog with automatic restart (exponential backoff, max 5 attempts), graceful shutdown on quit.
- **FR-009**: The application MUST bundle a Node.js runtime so that MCP servers run without requiring a user-installed Node.js.
- **FR-010**: Browser-based MCPs MUST use the system-installed Chrome via Playwright, not a bundled Chromium.
- **FR-011**: The application MUST detect when system Chrome is not available and clearly indicate which MCP tools are unavailable as a result.
- **FR-012**: The application MUST provide an auto-update mechanism that checks for updates, downloads in the background, verifies signatures, and prompts for restart.
- **FR-013**: The application MUST run a first-run onboarding flow that handles authentication, MCP configuration, and initial skill sync.
- **FR-014**: The application MUST integrate with `desktop-sync` for skill synchronization, respecting admin-configured version pins.
- **FR-015**: The application MUST integrate with `mcp-registry` for MCP server registration and lifecycle management.
- **FR-016**: The application MUST integrate with `mcp-governance` for governance mode enforcement and telemetry.
- **FR-017**: The application MUST write managed MCP entries to Claude Code's `.mcp.json` via `claudeCodeIntegration`.
- **FR-018**: The application MUST clean up orphaned MCP server processes on startup (via PID file).
- **FR-019**: The application MUST provide an IPC bridge between the Tauri Rust shell and the existing TypeScript business logic. (Implementation note: this is realized via a managed Node.js sidecar process communicating over JSON-RPC 2.0 — see plan.md for architecture details.)
- **FR-020**: On uninstall, the application MUST prompt the user to choose between full cleanup (remove managed `.mcp.json` entries, cached skills, bundled runtime, local usage data) or app-only removal (leave configuration and skills in place).
- **FR-021**: The application MUST report its own crashes, startup failures, and update errors through the existing telemetry pipeline (via `mcp-governance`), respecting the user's telemetry opt-out preference.
- **FR-022**: Usage pattern data MUST be stored locally on the user's machine and retained for 30 days, with automatic pruning of older records.
- **FR-023**: Feature changes MUST include tests covering all application lifecycle, IPC, and process management branches.
- **FR-024**: CI MUST produce signed, notarized builds for both platforms on every release.

### Key Entities

- **Application Shell**: The Tauri binary that hosts the web frontend and Rust backend, managing the application lifecycle.
- **Dashboard**: Web-based UI rendered by Tauri's webview showing system health, skills, MCPs, and usage.
- **System Tray**: Platform-native tray icon with context menu for quick access.
- **IPC Bridge**: Communication layer between the Tauri Rust process and the Node.js-hosted TypeScript business logic.
- **Bundled Runtime**: Embedded Node.js binary used to run MCP server processes.
- **Update Manifest**: Server-hosted JSON file describing available versions, download URLs, and signatures for the auto-updater.
- **Onboarding Flow**: Multi-step first-run wizard that configures auth, MCPs, and skill sync.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can download, install, and reach a working dashboard with healthy MCP servers in under 5 minutes on both macOS and Windows.
- **SC-002**: The installed application binary is under 30 MB (excluding bundled Node.js runtime).
- **SC-003**: MCP servers are available for Claude Code tool calls within 10 seconds of application startup.
- **SC-004**: Crashed MCP servers are automatically restarted within 30 seconds.
- **SC-005**: Application updates are downloaded and ready to install within 2 minutes of availability (on broadband connection).
- **SC-006**: The dashboard reflects MCP server state changes within 5 seconds.
- **SC-007**: The application runs continuously as a background service with less than 50 MB resident memory when idle (excluding MCP server processes).
- **SC-008**: Skill sync completes within 15 seconds on a warm cache.
- **SC-009**: Both platform builds (macOS + Windows) are produced from the same CI pipeline on every release.
- **SC-010**: 100% of managed MCP entries survive user edits to `.mcp.json` (re-added on next launch).

### Assumptions

- Apple Developer ID and Windows Authenticode code signing certificates are available.
- A self-hosted update manifest endpoint is available (or will be provisioned as part of this feature).
- The existing TypeScript packages (`policy-client`, `session-agent`, `skill-sync`, `desktop-sync`, `mcp-registry`, `mcp-governance`) are stable and do not require API changes for integration.
- Users have internet access during initial setup (offline-first operation is a post-install concern, handled by existing sync caching).
- System Chrome (or Chromium) is installed on most target machines; the app degrades gracefully when it is not.

## Clarifications

### Session 2026-03-14

- Q: Dashboard usage data — where and how long? → A: Local-only, last 30 days.
- Q: What should happen when a user uninstalls the app? → A: Prompt user to choose (keep data or clean everything).
- Q: Should the app report its own crashes and errors to a telemetry endpoint? → A: Yes, use existing telemetry pipeline.
