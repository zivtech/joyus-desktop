# WP11 — Known Limitations (T064)

**Feature**: 003 - Skill MCP Distribution
**Last Updated**: _______________
**Status**: Living document — update as limitations are resolved or new ones discovered.

---

## Phase 1 Limitations — Cowork Distribution

### L-001: Browser-Dependent MCPs Not Available in Cowork Without Desktop Companion

**Affected MCPs**: axe-core, lighthouse, screenshot
**Impact**: Non-developer users who only use Cowork (web) cannot access accessibility scanning, performance auditing, or screenshot capture tools without installing the desktop companion.
**Root Cause**: Cowork supports only HTTP/SSE MCP transport. These MCPs require a local browser engine (Chromium) and run via stdio transport.
**Workaround**: Install the desktop companion (Phase 2) to gain access to these tools. Alternatively, developers with CLI access can run these tools locally.
**Resolution Path**: A future hosted relay service could expose these MCPs over HTTP, but this is out of scope for this feature.

### L-002: Skill Sync Requires Manual Initial Setup for CLI Users

**Impact**: Developers using Claude Code CLI must run a one-time setup command to configure skill sync. This is not fully zero-touch.
**Root Cause**: The sync hook needs to be registered in the user's Claude Code configuration, which requires a deliberate opt-in step.
**Workaround**: The setup process is documented and takes under 2 minutes. Desktop companion users get automatic setup.
**Resolution Path**: Future versions could auto-detect org membership and configure sync automatically.

### L-003: Telemetry Opt-Out Is Per-Channel

**Impact**: A user who opts out of telemetry in Cowork is not automatically opted out in Claude Code CLI, and vice versa. There is no unified cross-channel opt-out.
**Root Cause**: Cowork and CLI have separate telemetry pipelines. Cowork telemetry is managed by Anthropic's platform; CLI telemetry is managed by the local sync/governance layer.
**Workaround**: Users must opt out in each channel separately if they wish to disable telemetry everywhere.
**Resolution Path**: A unified preference sync mechanism (potentially through the control plane) could propagate opt-out across channels.

### L-004: Version Pin Propagation Requires Session Restart

**Impact**: When an admin changes the pinned skill version, users do not receive the update until they start a new session. There is no hot-reload or mid-session update.
**Root Cause**: Skills are loaded at session initialization. Mid-session mutation would risk inconsistent state.
**Workaround**: Users can restart their session to pick up version changes immediately. Session restarts are fast (< 5 seconds for CLI, instant for Cowork).
**Resolution Path**: Hot-reload could be implemented with a session notification mechanism, but the complexity is not justified given fast restart times.

### L-005: Skill Bundles Are Static Assignments

**Impact**: Admin must manually assign skill bundles to users. There is no dynamic assignment based on project context or role changes.
**Root Cause**: The current implementation uses static bundle-to-user mappings in the distribution configuration.
**Workaround**: Admin updates the configuration and users receive changes on next session.
**Resolution Path**: Dynamic assignment rules (e.g., "all users in project X get bundle Y") could be added in a future iteration.

---

## Phase 2 Limitations — Desktop Companion

### L-006: macOS Only (Initially)

**Impact**: Windows and Linux users cannot use the desktop companion. They are limited to Cowork-distributed skills and cloud MCPs.
**Root Cause**: The desktop companion is built with Electron/Tauri targeting macOS first. Windows support requires additional packaging, code signing, and testing.
**Workaround**: Windows users can access all Phase 1 functionality (Cowork skills and cloud MCPs) without the companion. For browser-based MCPs, they can manually configure the MCP servers if they have Node.js.
**Resolution Path**: Windows support is planned for short-term (1-3 months). See next-steps.md.

### L-007: Local MCP Servers Require Node.js Runtime

**Impact**: The desktop companion requires Node.js >= 18 to be installed on the user's machine for local MCP servers to run.
**Root Cause**: MCP servers are implemented as Node.js processes. They are not bundled as standalone binaries.
**Workaround**: Most developer machines already have Node.js. The installer checks for Node.js and provides installation guidance if missing.
**Resolution Path**: Future versions could bundle a Node.js runtime or compile MCP servers to standalone executables using `pkg` or `nexe`.

### L-008: No Mobile Support

**Impact**: Skills and MCPs are not accessible from mobile devices (iOS or Android Claude apps, if they exist).
**Root Cause**: Mobile is explicitly out of scope for this feature. The distribution architecture targets desktop (web via Cowork, local via companion).
**Workaround**: None. Users must use a desktop or laptop.
**Resolution Path**: Mobile support would require either a hosted MCP relay or a mobile-native MCP client. This is a significant effort and is not currently planned.

### L-009: Chromium Dependency Adds ~200 MB

**Impact**: The desktop companion's disk footprint is larger than expected due to the bundled Chromium runtime required by browser-based MCPs (axe-core, lighthouse, screenshot).
**Root Cause**: These MCPs use Puppeteer/Playwright under the hood, which requires a Chromium binary.
**Workaround**: None — the Chromium dependency is required for browser-based MCP functionality.
**Resolution Path**: Chromium could be shared with an existing browser installation, or a lighter headless engine could be investigated. However, Puppeteer/Playwright compatibility is important for correctness.

### L-010: No Automatic Recovery on MCP Server Crash

**Impact**: If a local MCP server process crashes, the companion does not automatically restart it. The user must restart the companion manually.
**Root Cause**: Process supervision with automatic restart was deferred to reduce Phase 2 scope.
**Workaround**: Restart the desktop companion from the system tray menu or by relaunching the application.
**Resolution Path**: Add process health monitoring with automatic restart and exponential backoff. This is a short-term improvement.

---

## Deferred Features

Features that were considered but explicitly deferred from the current implementation:

### DF-001: Per-User Per-Skill Granular Permissions

**Description**: Allow admins to grant or revoke individual skills (not just bundles) per user.
**Reason Deferred**: Bundle-level assignment covers the immediate need. Granular permissions add significant admin complexity.
**Priority**: Medium-term (3-6 months).

### DF-002: Real-Time Collaboration Features

**Description**: Multiple users working with the same skill in a shared context (e.g., collaborative code review).
**Reason Deferred**: Requires changes to the Claude session model that are outside the scope of distribution infrastructure.
**Priority**: Not currently planned.

### DF-003: Custom Skill Authoring UI

**Description**: A visual interface for creating new skills without writing markdown files directly.
**Reason Deferred**: Existing skills are authored by developers comfortable with markdown. A UI would primarily benefit non-developers who are not the current skill authors.
**Priority**: Medium-term, contingent on demand.

### DF-004: MCP Server Health Dashboard in Companion

**Description**: A visual dashboard showing real-time health metrics for each local MCP server (uptime, request count, error rate, latency).
**Reason Deferred**: The system tray status indicator provides basic health info. A full dashboard requires additional UI development.
**Priority**: Short-term (1-3 months).

### DF-005: Hosted MCP Relay for Browser-Dependent Tools

**Description**: A cloud-hosted relay that exposes axe-core, lighthouse, and screenshot MCPs over HTTP, so Cowork web users can access them without the desktop companion.
**Reason Deferred**: Requires server infrastructure, adds latency, and raises security considerations (running a browser engine on a shared server).
**Priority**: Medium-term, contingent on demand from non-developer users.

### DF-006: Offline Mode for Skills

**Description**: Skills continue to work when the user is offline, even if they haven't synced recently.
**Reason Deferred**: The current sync mechanism caches the last successful sync, which provides partial offline support. Full offline mode with conflict resolution was deferred.
**Priority**: Low — current caching behavior is sufficient for most scenarios.

---

## Platform Constraints

External factors that constrain the system but are not bugs or missing features:

### PC-001: Cowork Plugin API May Change

**Impact**: The Cowork plugin format is versioned as v1. Anthropic may release breaking changes in future versions.
**Mitigation**: Plugin manifests include a `format_version` field. The packaging tool can be updated to generate new format versions as needed.

### PC-002: Claude Code `.mcp.json` Format May Evolve

**Impact**: The MCP configuration format used by Claude Code is not formally versioned and may change in future Claude Code releases.
**Mitigation**: The companion writes MCP entries using the current documented format. A migration script can be added if the format changes.

### PC-003: OAuth Token Lifecycle for First-Party MCPs

**Impact**: First-party MCP connectors (Atlassian, Slack, Google) use OAuth tokens that expire. Token refresh is handled by the Cowork platform, but edge cases (long-running sessions, revoked access) may cause mid-session failures.
**Mitigation**: Users are prompted to re-authenticate when a token expires. The experience is handled by Anthropic's platform.

### PC-004: Anthropic Rate Limits

**Impact**: MCP tool calls through Cowork are subject to Anthropic's rate limits for the Team plan. Heavy usage of MCP connectors may hit rate limits.
**Mitigation**: Rate limits are managed at the platform level. If limits are hit, users receive clear error messages from Cowork.

---

## Issue Tracker

Issues discovered during verification that were not resolved in this feature:

| # | Issue | Severity | Discovered In | Status | Resolution Plan |
|---|-------|----------|---------------|--------|-----------------|
| 1 | | Critical / Major / Minor | WP__ / T___ | Open / Deferred / Won't Fix | |
| 2 | | Critical / Major / Minor | WP__ / T___ | Open / Deferred / Won't Fix | |
| 3 | | Critical / Major / Minor | WP__ / T___ | Open / Deferred / Won't Fix | |

---

*This document should be reviewed and updated whenever new limitations are discovered or existing ones are resolved.*
