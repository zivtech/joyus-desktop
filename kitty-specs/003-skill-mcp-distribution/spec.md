# Feature Specification: Skill & MCP Server Distribution

**Feature Branch**: `003-skill-mcp-distribution`
**Created**: 2026-03-09
**Status**: Draft
**Input**: Need to distribute Zivtech meta-skills (29 prompt-only skills) and MCP servers (first-party cloud + custom local) to non-developer team members (PMs, COO, CEO, Dir of Ops) across Zivtech and Partner Org, with organizational control over governance, telemetry, and versioning.

## Context

### What We're Distributing

**Skills** (source: `zivtech-meta-skills`): 29 prompt-only Claude Code skills — planners, critics, specialists — that install as markdown files into `~/.claude/`. These are the source of truth for structured investigation protocols across software development, content strategy, public health, data visualization, and scientific research.

**First-party cloud MCPs**: Atlassian (Jira/Confluence), Playwright, Slack, Google Workspace, Figma, Notion — available as Anthropic-managed connectors via Claude Cowork.

**Custom MCP servers** (source: `zivtech-mcp-tools`): axe-core (accessibility), lighthouse (performance), readability (text analysis), screenshot (visual comparison), eval-runner (skill evaluation) — plus shell stubs for cms-api, coverage, drupal-api, pubmed, session-bridge. These run locally via stdio transport and require Node.js + browser dependencies.

### Target Users

| User | Org | Role | Technical Level | Primary Interface |
|------|-----|------|----------------|-------------------|
| PMs | Zivtech | Project management, client work | Non-developer | Claude Cowork (web) |
| COO | Zivtech | Operations, strategy | Non-developer | Claude Cowork (web) |
| CEO | Partner Org | Strategy, business development | Non-developer | Claude Cowork (web) |
| Dir of Ops | Partner Org | Operations, process management | Non-developer | Claude Cowork (web) |

### Distribution Platform: Claude Cowork (Team Plan)

Research confirmed (February 2026 Anthropic announcements):

- **Admin-managed connectors**: Admins can add MCP servers org-wide at `claude.ai/settings/connectors`. Team plan supports this.
- **Plugin system**: Cowork plugins bundle skills + connectors + slash commands. Admins can assign plugins to specific users.
- **Remote MCP servers**: Custom servers implementing MCP over HTTP (streamable-HTTP) can be added as connectors. OAuth 2.0 and authless both supported.
- **Claude.ai → Claude Code sync**: MCP servers configured in claude.ai automatically appear in Claude Code when signed in with the same account. The reverse does NOT apply.
- **No stdio in web**: Claude.ai/Cowork only supports HTTP/SSE transport — not stdio. Browser-dependent MCPs (axe-core, lighthouse, screenshot) cannot run in Cowork without a hosted relay.

## Scope

### In Scope

**Phase 1 — Cowork Distribution (immediate)**

- Packaging zivtech-meta-skills as Cowork-compatible plugins for non-developer users.
- Configuring first-party cloud MCP connectors (Atlassian, Playwright, Slack, Google, Figma, Notion) at the org level for both Zivtech and Partner Org Cowork workspaces.
- Git-based skill sync mechanism for Claude Code CLI users (developers) with zero manual git management required from the user.
- Skill version pinning so admin controls which version all users receive.
- Telemetry collection: which skills and MCPs are being used, by whom, how often.

**Phase 2 — Desktop Companion with Local MCPs (subsequent)**

- joyus-desktop companion app distributes and manages custom MCP servers that require local runtime (axe-core, lighthouse, screenshot — anything needing a browser engine).
- Desktop manages local git repos for skill sync transparently — user never interacts with git.
- Governance enforcement via the policy framework from feature 001.
- Telemetry reporting from local MCP usage back to the control plane.
- Update channel for MCP server versions (leveraging `packages/updater`).

### Out of Scope

- Server-side policy engine changes (belongs to `joyus-ai`).
- Building new skills — this feature distributes existing skills.
- Converting all custom MCPs to remote HTTP servers — browser-dependent MCPs stay local-only for Phase 2.
- Mobile app distribution.
- Enterprise plan features (private marketplace) — working within Team plan constraints.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Non-Developer Receives Skills via Cowork (Priority: P0)

A PM at Zivtech opens Claude Cowork and has access to relevant skills (e.g., proposal-critic, copy-critic, drupal-planner) without any local setup.

**Why this priority**: This is the primary delivery mechanism for the majority of target users.

**Independent Test**: Verify that a new Cowork user in the org can invoke a distributed skill within their first session.

**Acceptance Scenarios**:

1. **Given** admin has published skills as Cowork plugins, **When** a PM opens Claude Cowork, **Then** the assigned skills are available as slash commands or contextual tools.
2. **Given** admin updates a skill to a new version, **When** the PM's next session starts, **Then** the updated skill version is active.
3. **Given** admin revokes a skill from a user, **When** the user's next session starts, **Then** the skill is no longer available.

---

### User Story 2 — Non-Developer Accesses First-Party MCPs (Priority: P0)

The Partner Org CEO opens Claude Cowork and can query Jira issues, read Slack channels, and access Google Drive without configuring anything.

**Why this priority**: First-party MCPs are the highest-value, lowest-friction capability for non-developers.

**Independent Test**: Verify that each configured MCP connector responds to tool calls from a non-admin user account.

**Acceptance Scenarios**:

1. **Given** admin has configured Atlassian connector for the org, **When** user asks Claude to list Jira issues, **Then** Claude uses the Atlassian MCP and returns results.
2. **Given** admin has configured Slack connector, **When** user asks Claude to search Slack, **Then** Claude uses the Slack MCP and returns results.
3. **Given** user has not individually authorized a connector, **When** they first use it, **Then** they are prompted for OAuth consent (one-time).

---

### User Story 3 — Developer Receives Skills via Git Sync (Priority: P1)

A Zivtech developer using Claude Code CLI gets the latest skills auto-synced from the zivtech-meta-skills repo without manually running git commands.

**Why this priority**: Developers need the full-power CLI skills, and git sync preserves the source-of-truth workflow.

**Independent Test**: Verify that a developer's `~/.claude/` skills directory reflects the latest pinned version after sync runs.

**Acceptance Scenarios**:

1. **Given** the sync mechanism is installed, **When** developer starts a Claude Code session, **Then** skills are checked against the pinned version and updated if needed.
2. **Given** a new skill is added to the repo, **When** sync runs, **Then** the new skill appears in the developer's available skills.
3. **Given** the git remote is unreachable, **When** sync runs, **Then** the last successfully synced version is used (no failure, no data loss).

---

### User Story 4 — Admin Controls Skill Versions and Access (Priority: P1)

An admin pins skills to a specific git tag/release and controls which users or groups receive which skill subsets.

**Why this priority**: Governance requires version control and access segmentation — PMs don't need drupal-planner, Partner Org doesn't need Zivtech-internal skills.

**Independent Test**: Verify that version pinning and access controls are enforced across both Cowork and CLI distribution.

**Acceptance Scenarios**:

1. **Given** admin pins skills to version `v2.1.0`, **When** a newer version exists in the repo, **Then** users still receive `v2.1.0` until admin updates the pin.
2. **Given** admin assigns "PM Bundle" to Zivtech PMs, **When** a PM opens Cowork, **Then** only PM-relevant skills are available (not developer-focused skills like react-planner).
3. **Given** admin assigns "Partner Org Bundle" to Partner Org users, **When** a Partner Org user opens Cowork, **Then** only Partner Org-relevant skills are available.

---

### User Story 5 — Desktop Companion Manages Local MCPs (Priority: P2)

A developer installs the joyus-desktop companion, which automatically provisions and manages local MCP servers (axe-core, lighthouse, screenshot) without manual configuration.

**Why this priority**: Phase 2 — unlocks heavy-duty local tools for users who need browser-based analysis.

**Independent Test**: Verify that after desktop companion install, local MCP tools appear in Claude Code and respond to calls.

**Acceptance Scenarios**:

1. **Given** desktop companion is installed, **When** developer starts Claude Code, **Then** local MCP servers (axe-core, lighthouse, screenshot) are registered and available.
2. **Given** a new MCP server version is released, **When** desktop companion checks for updates, **Then** the update is applied transparently.
3. **Given** desktop companion is not installed, **When** developer uses Claude Code, **Then** Cowork-distributed skills and cloud MCPs still work — desktop is additive, not required.

---

### User Story 6 — Telemetry and Usage Monitoring (Priority: P1)

An admin can see which skills and MCPs are being used, by whom, and how often — enabling ROI measurement and identifying adoption gaps.

**Why this priority**: Control and monitoring is a core requirement. Without telemetry, there's no way to know if distribution is working.

**Independent Test**: Verify that skill invocations and MCP tool calls generate telemetry events that are queryable by admin.

**Acceptance Scenarios**:

1. **Given** telemetry is enabled, **When** a user invokes a skill or MCP tool, **Then** an event is recorded with user, skill/tool name, timestamp, and success/failure.
2. **Given** an admin views the telemetry dashboard, **When** they filter by org, **Then** they see aggregated usage across all distributed skills and MCPs.
3. **Given** telemetry is disabled for a specific user (opt-out), **When** they use skills/MCPs, **Then** no events are recorded for that user.

---

### Edge Cases

- User belongs to both Zivtech and Partner Org orgs — skill bundles must not conflict.
- Cowork session timeout mid-skill-execution — skill state should not corrupt.
- Git sync conflicts if user manually edited a skill file locally.
- OAuth token expiry for first-party MCPs mid-session.
- Network outage during skill version update — must not leave partial state.
- Skill depends on an MCP that the user doesn't have access to (e.g., skill references axe-core but user has no desktop companion).

## Requirements *(mandatory)*

### Functional Requirements

**Phase 1 — Cowork Distribution**

- **FR-001**: Skills from `zivtech-meta-skills` MUST be packageable as Cowork plugins that can be admin-assigned to users.
- **FR-002**: First-party MCP connectors (Atlassian, Slack, Google, Figma, Notion, Playwright) MUST be configurable at the org level by admin.
- **FR-003**: Skills MUST be organizable into named bundles (e.g., "PM Bundle", "Partner Org Bundle", "Developer Bundle") for role-based assignment.
- **FR-004**: Admin MUST be able to pin skills to a specific version (git tag or release).
- **FR-005**: A git-based sync mechanism MUST keep Claude Code CLI users' skills current with the pinned version, without requiring manual git commands.
- **FR-006**: Sync mechanism MUST fail gracefully on network unavailability, preserving the last good state.
- **FR-007**: Telemetry events MUST be emitted for skill invocations and MCP tool calls, including user identity, tool/skill name, timestamp, and outcome.
- **FR-008**: Telemetry MUST support per-user opt-out.

**Phase 2 — Desktop Companion**

- **FR-009**: Desktop companion MUST auto-provision local MCP servers (from `zivtech-mcp-tools`) on install.
- **FR-010**: Desktop companion MUST register local MCPs with Claude Code's MCP configuration without user intervention.
- **FR-011**: Desktop companion MUST check for and apply MCP server updates transparently.
- **FR-012**: Local MCP servers MUST report telemetry through the same pipeline as Cowork telemetry (FR-007).
- **FR-013**: Local MCP servers MUST respect governance policies from the control plane (tool blocking, audit mode).
- **FR-014**: Desktop companion MUST NOT be required for Cowork-distributed skills and cloud MCPs to function.

### Non-Functional Requirements

- **NFR-001**: Cowork plugin assignment MUST take effect within one session restart (no multi-day propagation delays).
- **NFR-002**: Git sync for CLI users MUST complete in under 10 seconds on a warm cache.
- **NFR-003**: Desktop companion install MUST complete in under 5 minutes on a standard macOS machine with broadband.
- **NFR-004**: Telemetry pipeline MUST not block or degrade the user's Claude session.

### Key Entities

- **Skill Bundle**: A named collection of skills assigned to a user group. Contains a manifest of skill names, versions, and target audience.
- **Distribution Channel**: The mechanism through which skills/MCPs reach users — either Cowork (web) or Desktop Companion (local).
- **Skill Version Pin**: A reference (git tag) that locks the distributed skill content to a specific point in time.
- **Telemetry Event**: A structured record of a skill invocation or MCP tool call, routed to the control plane for aggregation.
- **MCP Registry**: The set of MCP servers available to a user, composed from Cowork connectors + desktop companion local servers.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All target users (PMs, COO, CEO, Dir of Ops) can invoke at least one distributed skill in Cowork within 24 hours of admin configuration — zero local setup required.
- **SC-002**: All target first-party MCPs (Atlassian, Slack, Google minimum) are functional for all org users within 48 hours of admin configuration.
- **SC-003**: CLI developer skill sync operates without manual git commands — verified by at least 2 developer testers.
- **SC-004**: Admin can view aggregated telemetry showing skill/MCP usage per user within one week of rollout.
- **SC-005**: Version pin change propagates to all users within one session restart.
- **SC-006** (Phase 2): Desktop companion installs and provisions local MCPs for at least 2 testers without manual MCP configuration.

### Assumptions

- Zivtech and Partner Org both have active Claude Cowork Team plan subscriptions.
- Cowork's plugin system supports the skill format used by `zivtech-meta-skills` or a straightforward adaptation exists.
- First-party MCP connectors (Atlassian, Slack, Google) are available in the Cowork connector catalog for Team plans.
- The `zivtech-meta-skills` repo is accessible (read-only) to all target users or to a service account that handles sync.
- `zivtech-mcp-tools` critical bugs (async/await, tsconfig, workspace protocol) are fixed before Phase 2 begins.
- Server-side telemetry aggregation endpoint exists or will be created in `joyus-ai`.
