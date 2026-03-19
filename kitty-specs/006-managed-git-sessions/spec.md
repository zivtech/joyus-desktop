# Feature Specification: Managed Git Sessions

**Feature Branch**: `006-managed-git-sessions`
**Created**: 2026-03-19
**Status**: Draft
**Input**: Joyus Desktop (features 001–005 complete) needs a git management layer that serves both non-technical users who want full automation and developers who want advisory signals without interference.

## Scope

### In Scope

- Automatic workspace creation: on first file modification in a git repo during a session, the desktop app creates an isolated git worktree for that session.
- Mission labeling: each workspace is assigned a mission label (user-declared at session start or auto-inferred from early context).
- Hybrid drift detection: local heuristics (file path diversity, inferred topic spread, session duration) as the first pass; optional LLM confirmation and plain-language explanation when heuristics exceed thresholds.
- Tiered drift intervention: subtle (badge) to assertive (inline prompt) based on detection confidence.
- Dual-purpose session panel: shows all app-managed workspaces with status, mission label, last activity, and actions (resume / delete).
- Two operating modes: **managed** (full automation, no git terminology, for non-developers) and **advisory** (observe-and-suggest, opt-in only, for developers and Claude Code power users).
- GitHub Desktop integration as an optional companion: launch GitHub Desktop scoped to the workspace branch from within the panel.
- Stale workspace detection and one-click cleanup, with uncommitted-change warnings before destructive deletes.
- Context resumption: users can re-enter any prior workspace and have its mission context restored.

### Out of Scope

- Remote repository operations (push, pull, fetch) — the desktop app manages local worktrees only; remote operations remain the user's responsibility or GitHub Desktop's.
- Merge conflict resolution UI — the desktop app creates and isolates workspaces; resolution is outside its scope.
- Multi-repo workspace linking — each workspace is scoped to a single repository.
- AI code review or diff explanation within the panel — content analysis is limited to drift detection signals, not code quality feedback.
- Automatic commits on a timer or background schedule — commits happen at session close or on user action, not autonomously mid-session.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Non-Dev: Workspace Created Invisibly on First Change (Priority: P0)

A non-technical user starts a session and makes their first file change. The desktop app silently creates an isolated workspace. The user never sees a git command, branch name, or worktree path — they see only a session label and status indicator.

**Why this priority**: This is the foundational managed-mode guarantee. If this fails, every subsequent non-dev workflow breaks.

**Independent Test**: Automated test — simulate a managed-mode session; assert a worktree is created in the background on first file write; assert no git terminology appears in any user-facing notification.

**Acceptance Scenarios**:

1. **Given** managed mode is active and a session has no prior file changes, **When** the first file in a git repo is modified, **Then** the app creates a named worktree silently and associates it with the session.
2. **Given** the worktree is created, **When** the user views the session panel, **Then** they see a mission label and status indicator — no branch names, hashes, or git paths.
3. **Given** the session is in a non-git directory, **When** the first file is modified, **Then** no worktree is created and no error is surfaced; the session proceeds normally without workspace isolation.

---

### User Story 2 — Non-Dev: Drift Detected, New Session Suggested (Priority: P1)

A non-technical user begins a session to "update the homepage copy" but gradually shifts to debugging a payment integration. The app detects the divergence and prompts them to start a fresh session for the new topic.

**Why this priority**: Without drift detection, the whole premise of worktree isolation fails — users accumulate a single giant mixed-context workspace.

**Independent Test**: Heuristic unit tests — simulate file touch patterns across two distinct directories; assert drift signal fires above threshold. Integration test — assert tiered intervention UI appears at correct confidence levels.

**Acceptance Scenarios**:

1. **Given** a session has touched files in N distinct top-level directories and/or M inferred topic domains, **When** configurable drift thresholds are exceeded, **Then** a drift signal is generated with a confidence score.
2. **Given** a low-confidence drift signal (heuristics barely exceeded), **When** the signal is surfaced, **Then** a subtle badge or notification appears without blocking the user.
3. **Given** a high-confidence drift signal (heuristics well exceeded or LLM confirms), **When** the signal is surfaced, **Then** an assertive inline prompt appears suggesting the user start a new session and offers to create one immediately.
4. **Given** the user declines the suggestion, **When** they continue the session, **Then** the app records the declination and does not re-prompt for the same drift event.

---

### User Story 3 — Non-Dev: Resume a Prior Session (Priority: P1)

A non-technical user wants to return to a task they were working on two days ago. They open the session panel, see their labeled workspaces, and click to resume. The app restores the workspace context.

**Why this priority**: Without resumption, the workspace isolation creates friction instead of reducing it — users are stranded if they close the app.

**Independent Test**: Integration test — create a workspace, close and reopen the app, assert the workspace appears in the panel with correct label and status; assert resuming it restores the associated worktree as the active workspace.

**Acceptance Scenarios**:

1. **Given** a list of prior workspaces exists in the panel, **When** the user selects one and clicks "Resume", **Then** the app activates that worktree and restores the session mission context.
2. **Given** the workspace's git worktree is intact, **When** resumption completes, **Then** the workspace status changes to "active" and the panel reflects this.
3. **Given** the workspace's git worktree was manually deleted outside the app, **When** the user attempts to resume, **Then** the app surfaces a clear message (no git terminology) and offers to clean up the broken entry.

---

### User Story 4 — Non-Dev: Clean Up Stale Workspaces (Priority: P1)

A non-technical user has accumulated 12 workspaces over the past month. Many are from finished or abandoned tasks. They open the cleanup panel, see which are stale, and delete the ones they no longer need.

**Why this priority**: Without cleanup, the Codex-style "new folder for everything" pattern devolves into disk sprawl and user confusion.

**Independent Test**: Integration test — create multiple workspaces with varying last-activity timestamps; assert that workspaces inactive beyond the stale threshold are flagged; assert delete with uncommitted changes shows a warning and delete of clean workspace does not.

**Acceptance Scenarios**:

1. **Given** a workspace has had no activity for longer than the stale threshold, **When** the panel is open, **Then** the workspace is visually flagged as stale.
2. **Given** a stale workspace with no uncommitted changes, **When** the user deletes it, **Then** it is removed immediately with no warning dialog.
3. **Given** a workspace with uncommitted changes, **When** the user attempts to delete it, **Then** the app shows a plain-language warning ("This session has unsaved work") and requires explicit confirmation before deletion.
4. **Given** multiple stale workspaces, **When** the user invokes "clean up all stale", **Then** workspaces with no uncommitted changes are deleted in batch; workspaces with uncommitted changes are listed separately for individual review.

---

### User Story 5 — Dev: Advisory Mode, No Automatic Git Actions (Priority: P1)

A developer has advisory mode enabled. They use Claude Code heavily and manage their own git workflow. The app surfaces drift signals and workspace suggestions but never creates a branch, worktree, or commit without explicit user approval.

**Why this priority**: Developers have existing git workflows. Unexpected automatic actions would undermine trust and break their process.

**Independent Test**: Integration test — simulate a session in advisory mode with file modifications; assert no worktree is created; assert drift signals appear as suggestions with explicit action buttons; assert no git operation is performed until a button is clicked.

**Acceptance Scenarios**:

1. **Given** advisory mode is active and a session modifies files, **When** the first modification occurs, **Then** no worktree is created automatically.
2. **Given** drift is detected in advisory mode, **When** the signal is surfaced, **Then** a non-blocking suggestion appears (e.g., "This session is mixing concerns — want to branch off?") with explicit accept/dismiss actions.
3. **Given** a developer accepts a suggestion, **When** the action executes, **Then** the git operation is performed and a confirmation is shown with the underlying git details (branch name, path) visible.
4. **Given** a developer dismisses a suggestion, **When** they continue working, **Then** the app takes no git action and re-evaluates drift at the next threshold crossing.

---

### User Story 6 — Dev: GitHub Desktop Integration (Priority: P2)

A developer wants to use GitHub Desktop for reviewing diffs and creating pull requests, while still having Joyus Desktop manage session context. They click "Open in GitHub Desktop" from the session panel and GitHub Desktop opens scoped to the correct branch.

**Why this priority**: Bridges the managed/advisory gap — developers get the Joyus context layer without giving up their preferred git client.

**Independent Test**: Integration test — create a workspace; assert "Open in GitHub Desktop" triggers the GitHub Desktop deep-link URL protocol with the correct repository and branch parameters.

**Acceptance Scenarios**:

1. **Given** a workspace is associated with a git branch, **When** the user clicks "Open in GitHub Desktop", **Then** GitHub Desktop launches and navigates to that branch in the correct repository.
2. **Given** GitHub Desktop is not installed, **When** the user clicks "Open in GitHub Desktop", **Then** the app shows a message with a download link rather than a silent failure.

---

### Edge Cases

- User opens the same repository in two concurrent sessions: workspaces must not share a worktree; each session gets its own isolated worktree.
- A session starts in a subdirectory that is not the git root: the app must traverse up to find the git root before creating the worktree.
- Git repo is bare or corrupted: workspace creation must fail gracefully with a plain-language message; the session continues without isolation.
- User manually deletes a worktree folder outside the app: the panel must detect the missing worktree on next load and mark the workspace as "broken" rather than crashing.
- Stale threshold is configurable: default is 14 days; must be adjustable without restarting the app.
- Mode toggle (managed ↔ advisory): changing modes mid-session must not affect workspaces already created; takes effect for new sessions only.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: In managed mode, the app MUST create a named, isolated git worktree for a session on the first file modification within a git repository; no user action or confirmation is required.
- **FR-002**: Each workspace MUST be assigned a mission label: user-provided at session start if one is declared, or auto-inferred from the session's initial context if not.
- **FR-003**: Drift detection MUST evaluate at minimum: (a) the number of distinct top-level directories touched, (b) the number of inferred topic domains derived from file names and paths, and (c) elapsed session duration.
- **FR-004**: When local drift heuristics exceed configurable thresholds, the app MAY invoke an LLM to confirm the drift signal and generate a plain-language explanation for the user.
- **FR-005**: Drift intervention severity MUST scale with detection confidence: low confidence produces a passive notification; high confidence produces an assertive inline prompt offering to create a new session.
- **FR-006**: The session panel MUST display all app-managed workspaces with: mission label, last activity timestamp, status (active / stale / merged / broken), and actions appropriate to that status.
- **FR-007**: In managed mode, all git operations (worktree creation, branch naming) MUST use non-git terminology in every user-facing surface; no branch names, hashes, or git paths SHALL be exposed unless the user explicitly requests them.
- **FR-008**: In advisory mode, the app MUST NOT perform any git operation (worktree creation, branch creation, commit) without explicit user confirmation of a specific suggested action.
- **FR-009**: The app MUST support launching GitHub Desktop scoped to a workspace's branch and repository via the GitHub Desktop URL protocol.
- **FR-010**: Workspaces with no activity beyond a configurable stale threshold (default: 14 days) MUST be flagged as stale in the panel.
- **FR-011**: Deleting a workspace with uncommitted changes MUST require explicit user confirmation with a plain-language warning; deleting a clean workspace requires no confirmation.
- **FR-012**: Users MUST be able to resume any prior workspace; resumption MUST restore the worktree as active and display the workspace's mission context.
- **FR-013**: If a git worktree associated with a workspace is missing or corrupted, the app MUST mark the workspace "broken" and offer cleanup, without crashing or hiding the entry.
- **FR-014**: The operating mode (managed / advisory) MUST be configurable globally and optionally overridable per repository; mode changes take effect for new sessions only and do not affect existing workspaces.

### Key Entities

- **Workspace**: The core record managed by this feature. Represents one isolated git worktree tied to a session. Has a mission label, status (active / stale / merged / broken), creation timestamp, and last-activity timestamp.
- **Session**: A Claude Code conversation instance. In managed mode, a session is associated with exactly one workspace. In advisory mode, a session may have a suggested workspace that the user can accept.
- **Mission**: The declared or inferred purpose of a session. Used to label the workspace, anchor drift comparison, and restore context on resumption.
- **Drift Signal**: A detected divergence from the session's original mission. Has a confidence score, contributing heuristic values, and an optional LLM-generated explanation.
- **Operating Mode**: The user's configured interaction style — managed (full automation) or advisory (observe-and-suggest). Scoped globally or per repository.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Managed-mode users complete the full workspace lifecycle (create, work, resume, delete) without encountering any git terminology or needing any git knowledge.
- **SC-002**: Drift detection fires within 10 file-touch events or 30 minutes after a measurable context switch, whichever comes first, in 95% of simulated drift test scenarios.
- **SC-003**: Users can review all their workspaces, identify stale ones, and complete a full cleanup of all stale clean workspaces in under 60 seconds from panel open.
- **SC-004**: Resuming a prior workspace restores the session to active state and surfaces the mission label within 3 seconds of user action.
- **SC-005**: Advisory mode produces zero automatic git operations across all test scenarios; every git action requires a logged user confirmation event.
- **SC-006**: GitHub Desktop launches scoped to the correct branch in 100% of launch attempts on machines where it is installed.
- **SC-007**: Broken workspace detection catches 100% of externally-deleted worktrees on next panel load and marks them correctly without a crash.

### Assumptions

- The desktop app has read/write access to the local git repositories it manages; permission issues are surfaced as workspace creation failures.
- GitHub Desktop's URL protocol (`x-github-client://openRepo/...`) is available on machines where it is installed; the app does not need to install or configure it.
- Drift detection thresholds (FR-003, SC-002) are configurable via the app's settings layer; default values are defined at planning time.
- In advisory mode, developers are assumed to have their own git workflow and the app's role is additive, not authoritative.
- Worktree naming uses a human-readable convention (e.g., session date + mission slug) to remain interpretable if a user inspects the filesystem directly.
- The LLM call for drift confirmation is optional and gracefully degraded — if unavailable (offline, rate-limited), the heuristic-only signal is used without blocking the user.
