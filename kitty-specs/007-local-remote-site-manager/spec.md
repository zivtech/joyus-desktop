# Feature Specification: Local & Remote Site Manager

**Feature Branch**: `007-local-remote-site-manager`
**Created**: 2026-03-31
**Status**: Draft
**Input**: The Joyus Desktop app needs to provision, manage, and monitor site environments for Zivtech staff and clients. Zivtech PMs and ops get local Docker/DDEV environments; clients get remote environments via Probo (GitHub PR-triggered) or joyus-ai hosted fallback.

## Scope

### In Scope

- **Local environment provisioning (Zivtech internal, day 1)**: The desktop app detects, installs (with user consent), and manages container runtimes (OrbStack preferred, Docker Desktop fallback) and DDEV for running local Drupal/CMS sites.
- **One-click site setup**: Given a git repository URL, the app clones the repo, runs `ddev start`, and presents the user with a working local site URL — no terminal interaction required.
- **Local site lifecycle management**: Start, stop, restart, and destroy local DDEV sites from the desktop app's site manager panel.
- **Local site status monitoring**: The site manager panel shows all managed local sites with their current state (running / stopped / error), access URL, last activity, and resource usage indicators.
- **Remote environment monitoring via Probo**: For repositories with Probo's GitHub App installed, the desktop app surfaces Probo preview environments triggered by pull requests. The app discovers environments via GitHub deployment status events or PR check runs.
- **PR-to-environment linking**: When a task branch (Feature 006) is pushed and a PR is created, the site manager panel associates the PR with its Probo preview environment and displays the preview URL.
- **Remote environment fallback via joyus-ai**: For clients or projects without Probo, the desktop app can request a remote hosted environment from the joyus-ai platform API.
- **Site manager panel**: A unified panel showing both local and remote sites, their status, access URLs, and available actions.
- **Two audience tracks**: Zivtech internal users see local + remote options; client users see remote options only (Probo and joyus-ai hosted).
- **Integration with Feature 006 (Managed Git Sessions)**: When a user enters a QA, research, or demo mode, the git session manager (006) creates a branch and PR; this feature picks up the PR and surfaces the associated environment.

### Out of Scope

- **Production deployments**: This feature provisions preview/staging/development environments, not production infrastructure.
- **Site content management**: The app provisions and monitors sites; it does not provide a CMS editing interface.
- **DDEV plugin/add-on management**: The app runs `ddev start` with existing project configuration; customizing DDEV services or add-ons is the developer's responsibility.
- **Container runtime internals**: The app installs and starts OrbStack/Docker but does not manage container images, volumes, or networks beyond what DDEV handles.
- **Probo configuration**: The app reads Probo environments from existing GitHub integrations; it does not set up Probo for new repositories.
- **Linux support**: Local environment provisioning targets macOS and Windows initially (matching Feature 004's platform targets).
- **Custom domain or SSL configuration for local sites**: DDEV's default `.ddev.site` domains are used.

### Dependencies

- **Feature 006 (Managed Git Sessions)**: FR-018 through FR-022 — push-to-remote and draft PR creation. The site manager consumes PR associations and deployment status data from 006's TaskBranch entity.
- **joyus-ai platform API**: For the remote hosted environment fallback path. API contracts for environment provisioning are defined by the joyus-ai project.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — PM: Set Up a Local Site for the First Time (Priority: P0)

A Zivtech PM needs to run a client's Drupal site locally to review a feature before a client demo. They have never used Docker or DDEV. The desktop app guides them through installing the container runtime and DDEV, clones the project repository, starts the site, and presents a working URL.

**Why this priority**: This is the foundational local workflow. If a PM cannot go from zero to a running local site without terminal commands, the feature fails its core promise.

**Independent Test**: End-to-end test — simulate a machine with no container runtime installed; assert the app detects the missing runtime, offers installation, completes setup, clones a test repo, runs `ddev start`, and the site responds at the expected URL.

**Acceptance Scenarios**:

1. **Given** no container runtime is installed, **When** the user opens the site manager and requests a new local site, **Then** the app detects the missing runtime and offers to install OrbStack (preferred) or Docker Desktop, with a plain-language explanation of what it is and why it's needed.
2. **Given** a container runtime is installed but DDEV is not, **When** the user requests a new local site, **Then** the app installs DDEV automatically (with user consent) and confirms successful installation.
3. **Given** runtime and DDEV are both installed, **When** the user provides a git repository URL (or selects from a configured project list), **Then** the app clones the repository, runs `ddev start`, and within the expected startup time presents the local site URL in the site manager panel.
4. **Given** the site is starting, **When** the user views the site manager panel, **Then** they see a progress indicator with plain-language status ("Setting up your site...", "Starting services...", "Almost ready...") — no raw terminal output.
5. **Given** `ddev start` fails (port conflict, missing config, corrupted image), **When** the failure occurs, **Then** the app shows a plain-language error message with a suggested action (e.g., "Another application is using port 443 — close it and try again") rather than raw error output.

---

### User Story 2 — PM: Manage Running Local Sites (Priority: P1)

A Zivtech PM has three local sites set up for different client projects. They open the site manager panel to check which are running, stop one to free resources, and open another in their browser.

**Why this priority**: Without lifecycle management, users accumulate running containers that consume resources and have no way to control them without terminal access.

**Independent Test**: Integration test — provision two local sites; assert the panel shows both with correct status; assert stop/start/open-in-browser actions work correctly; assert resource indicators update after state changes.

**Acceptance Scenarios**:

1. **Given** multiple local sites exist, **When** the user opens the site manager panel, **Then** each site is listed with: project name, status (running / stopped / error), access URL (clickable), and last activity timestamp.
2. **Given** a running site, **When** the user clicks "Stop", **Then** the site stops within 30 seconds and the status updates to "stopped".
3. **Given** a stopped site, **When** the user clicks "Start", **Then** the site starts and the status updates to "running" with the access URL active.
4. **Given** a running site, **When** the user clicks "Open", **Then** the site opens in the user's default browser.
5. **Given** a site the user no longer needs, **When** they click "Remove" and confirm, **Then** the site is stopped, the DDEV project is destroyed, and the entry is removed from the panel. The cloned repository remains on disk unless the user opts to delete it.
6. **Given** two running sites, **When** one is consuming excessive resources (high CPU/memory), **Then** the site manager shows a visual indicator of resource pressure so the user can decide whether to stop it.

---

### User Story 3 — PM: View Probo Preview Environments from a PR (Priority: P1)

A Zivtech PM pushes changes via a managed git session (Feature 006). The task branch is pushed, a draft PR is created, and Probo spins up a preview environment. The PM sees the preview URL in the site manager panel without leaving the desktop app.

**Why this priority**: This bridges the git workflow (006) to the site management workflow (007), completing the "make changes → see them live" loop for non-technical users.

**Independent Test**: Integration test — simulate a TaskBranch with a PR association; mock GitHub deployment status API to return a Probo environment URL; assert the site manager panel displays the environment with status and clickable URL.

**Acceptance Scenarios**:

1. **Given** a task branch has been pushed and a PR created (via Feature 006), **When** the Probo environment finishes building, **Then** the site manager panel shows the preview environment with status "ready" and a clickable URL.
2. **Given** the Probo environment is still building, **When** the user views the site manager, **Then** the entry shows status "building" with a progress indicator.
3. **Given** the Probo environment build fails, **When** the failure is reported via GitHub status, **Then** the site manager shows status "failed" with a link to the PR for troubleshooting.
4. **Given** multiple PRs exist for the same repository, **When** the user views the site manager, **Then** each PR's Probo environment is listed as a separate entry with the PR title as the label.
5. **Given** the PR is merged or closed, **When** Probo tears down the environment, **Then** the site manager updates the entry to "expired" and removes the access URL.

---

### User Story 4 — Client: Access a Remote Preview Environment (Priority: P2)

A client stakeholder receives a link to the Joyus Desktop app (or a simplified web view). They can see the Probo preview environments associated with their project's open PRs, click through to review the site, and leave feedback — all without any local setup.

**Why this priority**: Clients should never need Docker or DDEV. Remote environments via Probo (or joyus-ai hosted) are their primary path.

**Independent Test**: Integration test — simulate a client-mode user; assert no local site provisioning options are shown; assert Probo environments for their project are listed with access URLs.

**Acceptance Scenarios**:

1. **Given** a client user opens the site manager, **When** the panel loads, **Then** only remote environments (Probo and joyus-ai hosted) are shown — no local site setup options.
2. **Given** the client's project has open PRs with Probo environments, **When** the panel loads, **Then** each environment is listed with its PR title, status, and clickable preview URL.
3. **Given** no Probo environments exist for the client's project, **When** the panel loads, **Then** a message explains that preview environments are created when changes are submitted, with no confusing empty state.

---

### User Story 5 — PM: Request a Remote Hosted Environment via joyus-ai (Priority: P2)

A Zivtech PM is working on a project that does not have Probo enabled. They need a preview environment for a client demo. The desktop app lets them request a remote hosted environment from the joyus-ai platform.

**Why this priority**: Probo coverage is not universal. The joyus-ai fallback ensures every project has a path to preview environments.

**Independent Test**: Integration test — simulate a project without Probo; assert the "Request remote environment" action is available; mock joyus-ai API to return an environment URL; assert it appears in the panel.

**Acceptance Scenarios**:

1. **Given** a project without Probo integration, **When** the user views the site manager, **Then** a "Request preview environment" action is available alongside local site options.
2. **Given** the user clicks "Request preview environment", **When** the joyus-ai API provisions the environment, **Then** the site manager shows the environment with status "provisioning" → "ready" and a clickable URL.
3. **Given** the joyus-ai API is unavailable, **When** the request fails, **Then** the app shows a plain-language error and suggests trying again later — no crash, no silent failure.
4. **Given** a joyus-ai hosted environment that has been idle beyond its TTL, **When** the environment is torn down, **Then** the site manager updates the entry to "expired" with an option to re-provision.

---

### User Story 6 — PM: Environment Auto-Linked from Git Session (Priority: P1)

A Zivtech PM starts a new git session in managed mode to investigate a QA issue. Feature 006 creates a task branch, they make changes, and on session close the branch is pushed and a PR is created. The site manager automatically picks up the new PR and surfaces the Probo environment — the PM never explicitly asked for a preview environment.

**Why this priority**: This is the seamless integration between Features 006 and 007 that makes the whole workflow feel automatic rather than requiring separate manual steps.

**Independent Test**: End-to-end test — simulate the full flow: managed-mode session → file changes → session close → push → PR creation → Probo build → environment URL appears in site manager. Assert no manual intervention required between session close and environment appearing.

**Acceptance Scenarios**:

1. **Given** a managed-mode session closes with committed changes, **When** the branch is pushed and PR created (Feature 006), **Then** the site manager panel automatically shows a new entry for the Probo environment within 60 seconds of the PR being created.
2. **Given** the user did not explicitly request a preview environment, **When** the Probo environment becomes ready, **Then** a notification appears: "Preview ready for [mission label]" with a link to open it.
3. **Given** the user starts a new git session for a different task in the same repository, **When** the new branch is pushed, **Then** a separate environment entry appears — environments are 1:1 with PRs, not shared across sessions.

---

### Edge Cases

- **No container runtime available on client machine**: Client users never see local options. If a Zivtech user's machine cannot support Docker/OrbStack (e.g., insufficient resources), the app suggests using remote environments instead.
- **DDEV project already exists**: If the user clones a repo that already has a `.ddev/` directory with configuration, the app uses the existing config rather than re-initializing. If the repo has no `.ddev/` config, the app cannot proceed with local setup and suggests contacting the project's developer.
- **Port conflicts**: If `ddev start` fails due to port conflicts, the app identifies the conflicting port and suggests stopping the conflicting service or changing DDEV's port configuration.
- **Multiple container runtimes**: If both OrbStack and Docker Desktop are installed, the app uses whichever DDEV is configured to use (or the one DDEV auto-detects). No preference override UI is provided.
- **Probo environment expiry**: Probo environments are ephemeral and expire. The site manager must handle environments disappearing between panel refreshes gracefully — no crashes, no stale "ready" indicators.
- **GitHub API rate limiting**: When polling for deployment statuses or PR check runs, the app respects GitHub API rate limits and backs off gracefully. Status updates may be delayed but never lost.
- **Offline mode**: Local sites continue to work offline. Remote environment status is cached and marked "last checked [timestamp]" when the network is unavailable.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app MUST detect the presence of a container runtime (OrbStack or Docker Desktop) on the user's machine. If none is found, the app MUST offer to install OrbStack (preferred) or Docker Desktop with a plain-language explanation and user consent before proceeding.
- **FR-002**: The app MUST detect the presence of DDEV. If DDEV is not installed, the app MUST install it automatically (with user consent) using the official DDEV installation method for the user's platform.
- **FR-003**: Given a git repository URL and a detected runtime + DDEV, the app MUST clone the repository (if not already cloned), run `ddev start`, and present the user with the local site URL in the site manager panel. The entire flow MUST complete without requiring the user to open a terminal.
- **FR-004**: The site manager panel MUST display all managed sites (local and remote) with: project name, environment type (local / Probo / joyus-ai hosted), status (running / stopped / building / ready / failed / expired / error), access URL (clickable when available), and last activity or last status check timestamp.
- **FR-005**: For local sites, the app MUST support lifecycle actions: start, stop, restart, open in browser, and remove (with confirmation). Remove MUST stop the site and destroy the DDEV project; the cloned repository is retained unless the user explicitly opts to delete it.
- **FR-006**: The app MUST display resource usage indicators (CPU/memory pressure) for running local sites so users can make informed decisions about stopping sites to free resources.
- **FR-007**: For repositories with Probo's GitHub App installed, the app MUST discover Probo preview environments by querying GitHub deployment status events or PR check runs associated with pull requests. The app MUST display these environments in the site manager panel with status and access URL.
- **FR-008**: When a TaskBranch (Feature 006) has a PR association with deployment status data, the site manager MUST automatically surface the associated Probo environment without requiring the user to manually link or search for it.
- **FR-009**: For projects without Probo, the app MUST offer a "Request remote environment" action that provisions an environment via the joyus-ai platform API. The provisioning status (provisioning → ready → expired) MUST be reflected in the site manager panel.
- **FR-010**: Client users MUST see only remote environment options (Probo and joyus-ai hosted) in the site manager. Local site provisioning options MUST NOT be shown to client users. User type (internal / client) is determined by the user's organization membership in the joyus-ai platform.
- **FR-011**: All user-facing text in the site manager MUST use plain language appropriate for non-technical users. Error messages MUST include a suggested action rather than raw error output. Technical details (container IDs, port numbers, stack traces) MUST be hidden behind a "show details" expansion.
- **FR-012**: Local site provisioning failures (port conflicts, missing config, corrupted images, insufficient disk space) MUST be caught and presented as actionable plain-language messages. The app MUST NOT crash or show raw terminal output.
- **FR-013**: When a Probo environment's PR is merged or closed and the environment is torn down, the site manager MUST update the entry to "expired" and remove the access URL within 60 seconds of detecting the status change.
- **FR-014**: The app MUST persist local site metadata (project name, repository path, DDEV project name, status, creation timestamp) in the existing SQLite store (shared schema with Feature 006's TaskBranch store or a companion table).
- **FR-015**: The app MUST respect GitHub API rate limits when polling for deployment statuses. If rate-limited, the app MUST back off and show the last known status with a "last checked" timestamp rather than failing.
- **FR-016**: When a managed-mode git session creates a branch and PR (Feature 006, FR-018/FR-019), and the repository has Probo enabled, the site manager MUST surface the resulting Probo environment automatically and notify the user when it is ready.

### Key Entities

- **ManagedSite**: A site environment managed by the desktop app. Has a project name, environment type (local / probo / joyus-ai-hosted), status, access URL, repository association, and optional TaskBranch/PR association. Local sites have additional fields: DDEV project name, repository clone path, resource usage snapshot.
- **EnvironmentType**: The provisioning strategy for a site — local (DDEV on user's machine), probo (GitHub PR-triggered ephemeral environment), or joyus-ai-hosted (remote environment provisioned via joyus-ai platform API).
- **SiteStatus**: The lifecycle state of a managed site — running, stopped, building, ready, failed, expired, error. Transitions vary by environment type: local sites cycle through stopped ↔ running; remote sites progress through building → ready → expired.
- **RuntimeDependency**: A prerequisite for local site provisioning — container runtime (OrbStack or Docker Desktop) and DDEV. Each has a detection check and an installation flow.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user with no container runtime or DDEV installed can go from zero to a running local site within 15 minutes (including installation time), with no terminal interaction required.
- **SC-002**: Local site lifecycle actions (start, stop, restart, open, remove) complete within 30 seconds of user action and the panel status updates accurately.
- **SC-003**: Probo preview environment URLs appear in the site manager panel within 60 seconds of the environment becoming ready (as reported by GitHub deployment status).
- **SC-004**: The auto-linking flow (Feature 006 session close → push → PR → Probo environment → site manager entry) completes without manual intervention in 95% of attempts on repositories with Probo enabled.
- **SC-005**: Client users see zero local site provisioning options in the site manager — only remote environments.
- **SC-006**: All provisioning error scenarios (port conflict, missing config, network failure, API unavailability) produce a plain-language message with suggested action — no raw error output reaches the user.
- **SC-007**: The site manager panel accurately reflects the current state of all managed sites (local and remote) with no stale "ready" indicators for environments that have been torn down.

### Assumptions

- Zivtech client projects use DDEV for local development and have a `.ddev/` configuration directory in their git repositories. Projects without DDEV config cannot be provisioned locally via this feature.
- OrbStack and Docker Desktop both support the container operations DDEV requires. The app does not need to account for edge cases in container runtime compatibility beyond what DDEV handles.
- Probo's GitHub App posts deployment status events or check run annotations with environment URLs that can be discovered via the GitHub API. The exact event format is verified during planning.
- The joyus-ai platform API for environment provisioning is defined separately in the joyus-ai project; this feature depends on that API existing but does not define its contracts.
- GitHub authentication for API calls (deployment status queries, PR status) reuses the same credentials established by Feature 006 (user's `gh` CLI authentication).
- DDEV installation on macOS uses Homebrew; on Windows uses the official DDEV installer. The app delegates to these standard installation methods.
- Resource usage indicators for local sites use DDEV's built-in status reporting or Docker API stats; precise metrics are determined during planning.
