# Feature Specification: Managed Git Sessions

**Feature Branch**: `006-managed-git-sessions`
**Created**: 2026-03-19
**Status**: Draft (v2 — revised after proposal-critic + qa-critic review)
**Input**: Joyus Desktop (features 001–005 complete) needs a git management layer that serves both non-technical users who want full automation and developers who want advisory signals without interference.

## Scope

### In Scope

- Automatic task branch creation: on first file modification in a git repo during a session, the desktop app creates an isolated git worktree for that session. The mechanism for detecting "first file modification" is an open architecture question to be resolved in planning (candidates: filesystem watcher, git-status polling, Claude Code IPC hook).
- Mission labeling: each task branch is assigned a mission label (user-declared at session start or auto-inferred from early file context).
- Hybrid drift detection: local heuristics (file path diversity, inferred topic spread, session duration) as the first pass; optional LLM confirmation and plain-language explanation when heuristics exceed thresholds.
- Tiered drift intervention: subtle (badge) to assertive (inline prompt) based on detection confidence.
- Dual-purpose session panel: shows all app-managed task branches with status, mission label, last activity, and actions (resume / delete).
- Two operating modes: **managed** (full automation, no git terminology, for non-developers) and **advisory** (observe-and-suggest, opt-in only, for developers and Claude Code power users).
- New persistence layer: a local SQLite store for task branch metadata (mission labels, status, timestamps, mode) — this is new infrastructure, not an extension of existing session tracking.
- GitHub Desktop integration as an optional companion: launch GitHub Desktop scoped to the task branch from within the panel.
- Stale task branch detection and one-click cleanup, with uncommitted-change warnings before destructive deletes.
- Context resumption: users can re-enter any prior task branch and have its mission context restored.

### Out of Scope

- Remote repository operations beyond push and draft PR creation — pull, fetch, and merge remain the user's responsibility or GitHub Desktop's. Push-to-remote and draft PR creation are in scope for managed mode (see FR-018, FR-019).
- Merge conflict resolution UI — the desktop app creates and isolates task branches; resolution is outside its scope.
- Multi-repo task branch linking — each task branch is scoped to a single repository.
- AI code review or diff explanation within the panel — content analysis is limited to drift detection signals, not code quality feedback.
- Automatic commits on a timer or background schedule — commits happen at session close or on explicit user action, not autonomously mid-session.
- Branch cleanup after merge: git branches associated with deleted task branches are not automatically deleted; a post-delete prompt will suggest branch cleanup but not enforce it.

### Open Architecture Questions (resolve during planning)

1. **File modification detection mechanism**: How does the app detect "first file modification in a git repo"? Options: (a) filesystem watcher (e.g., chokidar); (b) periodic `git status` polling; (c) Claude Code session sends an IPC notification when it first writes a file. Each has different performance, permission, and offline-mode implications.
2. **Git operation layer**: The existing codebase has an `execGit` wrapper in `packages/desktop-sync`. Determine whether the new task branch operations (`git worktree add/remove/list`) reuse that wrapper or require a new abstraction.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Non-Dev: Task Branch Created Invisibly on First Change (Priority: P0)

A non-technical user starts a session and makes their first file change. The desktop app silently creates an isolated task branch. The user never sees a git command, branch name, or worktree path — they see only a session label and status indicator.

**Why this priority**: This is the foundational managed-mode guarantee. If this fails, every subsequent non-dev workflow breaks.

**Independent Test**: Automated test — simulate a managed-mode session; assert a worktree is created in the background on first file write; assert no word from the git terminology blocklist (branch, commit, hash, HEAD, checkout, merge, stash, worktree, ref, diff, push, pull) appears in any user-facing notification or label.

**Acceptance Scenarios**:

1. **Given** managed mode is active and a session has no prior file changes, **When** the first file in a git repo is modified, **Then** the app creates a named worktree silently and associates it with the session.
2. **Given** the worktree is created, **When** the user views the session panel, **Then** they see a mission label and status indicator — no words from the git terminology blocklist appear in any visible text.
3. **Given** the session is in a non-git directory, **When** the first file is modified, **Then** no worktree is created and no error is surfaced; the session proceeds normally without isolation.
4. **Given** two sessions open the same repository at the same time and both trigger their first file modification, **When** both task branch creation events complete, **Then** each session has a distinct, uniquely-named worktree and neither session's file changes appear in the other's worktree.
5. **Given** two task branches would produce the same name (same date and same inferred mission slug), **When** the second is created, **Then** the app disambiguates the name (e.g., appends a counter) rather than failing or overwriting.

---

### User Story 2 — Non-Dev: Drift Detected, New Session Suggested (Priority: P1)

A non-technical user begins a session to "update the homepage copy" but gradually shifts to debugging a payment integration. The app detects the divergence and prompts them to start a fresh session for the new topic.

**Why this priority**: Without drift detection, the whole premise of task branch isolation fails — users accumulate a single giant mixed-context workspace.

**Independent Test**: Heuristic unit tests — simulate file touch patterns across two distinct top-level directories and two distinct inferred topic domains; assert drift signal fires above default thresholds (3 directories OR 2 topic domains OR 30 minutes elapsed). Integration test — assert tiered intervention UI appears at correct confidence levels.

**Default drift thresholds** (configurable; defined here as the planning baseline):
- Directory threshold: 3 distinct top-level directories
- Topic domain threshold: 2 distinct inferred topic domains (derived from path segments and file extensions)
- Time threshold: 30 minutes elapsed session time
- LLM escalation: triggered when any two thresholds are exceeded simultaneously

**Acceptance Scenarios**:

1. **Given** a session has touched files in 3 or more distinct top-level directories, **When** the threshold is crossed, **Then** a drift signal is generated with a low-confidence score.
2. **Given** a session has crossed both the directory threshold and the topic domain threshold, **When** the combined signal is evaluated, **Then** a high-confidence drift signal is generated.
3. **Given** a low-confidence drift signal, **When** the signal is surfaced, **Then** a subtle badge or notification appears without blocking the user.
4. **Given** a high-confidence drift signal (two or more thresholds exceeded, or LLM confirms), **When** the signal is surfaced, **Then** an assertive inline prompt appears suggesting the user start a new session and offers to create one immediately.
5. **Given** the user declines the suggestion, **When** they continue the session, **Then** the app records the declination and does not re-prompt for the same drift event.
6. **Given** a single coherent task that legitimately spans 3+ directories (e.g., a feature touching frontend, backend, and config), **When** the user has previously dismissed a drift prompt, **Then** the dismissal is honored and the user is not re-prompted until the next threshold crossing.
7. **Given** the LLM confirmation service is unavailable (offline, rate-limited, or times out), **When** local heuristics exceed the high-confidence threshold, **Then** the heuristic-only signal is used, the user sees the appropriate intervention, and no error or spinner is shown related to the LLM call.

---

### User Story 3 — Non-Dev: Resume a Prior Session (Priority: P1)

A non-technical user wants to return to a task they were working on two days ago. They open the session panel, see their labeled task branches, and click to resume. The app restores the task branch context.

**Why this priority**: Without resumption, the task branch isolation creates friction instead of reducing it — users are stranded if they close the app.

**Independent Test**: Integration test — create a task branch, close and reopen the app, assert the task branch appears in the panel with correct label and status; assert resuming it activates the worktree and surfaces the mission label.

**Acceptance Scenarios**:

1. **Given** a list of prior task branches exists in the panel, **When** the user selects one and clicks "Resume", **Then** the app activates that worktree and restores the session mission context; the status changes to "active".
2. **Given** the task branch was created in managed mode and the user is now in advisory mode, **When** the user resumes it, **Then** the task branch is activated and the panel continues to use non-git terminology for that task branch (the mode governing a task branch is the mode active when it was created, not the current global mode).
3. **Given** the task branch's git worktree was manually deleted outside the app, **When** the user attempts to resume, **Then** the app surfaces a clear plain-language message ("This session's files are no longer available") and offers to clean up the broken entry.
4. **Given** a task branch that was flagged as stale, **When** the user resumes it, **Then** the stale flag is cleared and the status becomes "active".

---

### User Story 4 — Non-Dev: Clean Up Stale Task Branches (Priority: P1)

A non-technical user has accumulated 12 task branches over the past month. Many are from finished or abandoned tasks. They open the session panel, see which are stale, and delete the ones they no longer need.

**Why this priority**: Without cleanup, the Codex-style "new folder for everything" pattern devolves into disk sprawl and user confusion.

**Independent Test**: Integration test — create multiple task branches with varying last-activity timestamps; assert that task branches inactive beyond the stale threshold are flagged; assert delete with uncommitted changes shows a warning and delete of clean task branch does not.

**Acceptance Scenarios**:

1. **Given** a task branch has had no activity for longer than the stale threshold (default 14 days), **When** the panel is open, **Then** the task branch is visually flagged as stale.
2. **Given** a stale task branch with no uncommitted changes, **When** the user deletes it, **Then** it is removed immediately with no warning dialog, and a post-delete prompt offers to also delete the underlying git branch.
3. **Given** a task branch with uncommitted changes, **When** the user attempts to delete it, **Then** the app shows a plain-language warning ("This session has unsaved work") and requires explicit confirmation before deletion.
4. **Given** multiple stale task branches, **When** the user invokes "clean up all stale", **Then** task branches with no uncommitted changes are deleted in batch; task branches with uncommitted changes are listed separately for individual review.
5. **Given** a batch cleanup of 8 stale task branches where worktree deletion fails for one (e.g., file lock or permission denied), **When** the batch completes, **Then** the successfully deleted entries are removed, the failed entry remains in the panel with an error indicator and a plain-language explanation, and the cleanup is not silently treated as fully successful.
6. **Given** the stale threshold is changed from 14 days to 7 days in settings, **When** the panel is next opened or refreshed, **Then** task branches inactive for 7–14 days are now flagged as stale without requiring an app restart.

---

### User Story 5 — Non-Dev: Task Branch Reaches "Merged" State (Priority: P2)

A non-technical user has finished a task. After their changes are incorporated, the task branch is marked as merged and presented as safe to clean up.

**Why this priority**: Without a "merged" lifecycle state, completed task branches look identical to stale ones — users cannot distinguish "done and safe to delete" from "abandoned and might matter."

**Independent Test**: Integration test — simulate a task branch whose underlying git branch has been merged into the repository's default branch; assert the panel detects the merged state and displays appropriate actions.

**Acceptance Scenarios**:

1. **Given** a task branch's underlying git branch has been merged into the repository's default branch, **When** the panel refreshes, **Then** the task branch status changes to "merged" automatically.
2. **Given** a task branch in "merged" status, **When** the user views the panel, **Then** the available actions are "delete" (with no uncommitted-changes warning, since the work is merged) and "view history" — not "resume".
3. **Given** a task branch in "merged" status with no uncommitted changes, **When** the user deletes it, **Then** it is removed immediately with a prompt to also delete the underlying git branch.

---

### User Story 6 — Dev: Advisory Mode, No Automatic Git Actions (Priority: P1)

A developer has advisory mode enabled. They use Claude Code heavily and manage their own git workflow. The app surfaces drift signals and task branch suggestions but never creates a branch, worktree, or commit without explicit user approval.

**Why this priority**: Developers have existing git workflows. Unexpected automatic actions would undermine trust and break their process.

**Independent Test**: Integration test — simulate a session in advisory mode with file modifications; assert no worktree is created; assert drift signals appear as suggestions with explicit action buttons; assert no git operation is performed until a button is clicked.

**Acceptance Scenarios**:

1. **Given** advisory mode is active and a session modifies files, **When** the first modification occurs, **Then** no worktree is created automatically.
2. **Given** drift is detected in advisory mode at high confidence, **When** the signal is surfaced, **Then** a non-blocking suggestion appears ("This session is mixing concerns — want to branch off?") with explicit accept/dismiss actions; no git operation is performed before the user acts.
3. **Given** a developer accepts a suggestion, **When** the action executes, **Then** the git operation is performed and a confirmation is shown with the underlying git details (branch name, path) visible.
4. **Given** a developer dismisses a suggestion, **When** they continue working, **Then** the app takes no git action and re-evaluates drift at the next threshold crossing.
5. **Given** advisory mode is active and the user opens the session panel for a task branch that was originally created in managed mode, **When** they view the available actions, **Then** the actions are the same as for any task branch; advisory mode does not retroactively change the mode governing that task branch.
6. **Given** advisory mode is switched on globally after a managed-mode task branch already exists, **When** a new session starts in the same repository, **Then** the new session gets no automatic worktree; the existing managed-mode task branch is unaffected and continues to display with non-git terminology.
7. **Given** advisory mode is active and any event (drift, resumption, cleanup) would in managed mode trigger an automatic git operation, **When** that event occurs, **Then** zero git operations are performed without a logged user confirmation; this invariant holds across all code paths.

---

### User Story 7 — Dev: GitHub Desktop Integration (Priority: P2)

A developer wants to use GitHub Desktop for reviewing diffs and creating pull requests, while still having Joyus Desktop manage session context. They click "Open in GitHub Desktop" from the session panel and GitHub Desktop opens scoped to the correct branch.

**Why this priority**: Bridges the managed/advisory gap — developers get the Joyus context layer without giving up their preferred git client.

**Independent Test**: Integration test — create a task branch; assert "Open in GitHub Desktop" triggers the GitHub Desktop URL protocol with the correct repository path and branch parameters.

**Acceptance Scenarios**:

1. **Given** a task branch is associated with a git branch, **When** the user clicks "Open in GitHub Desktop", **Then** GitHub Desktop launches and navigates to that branch in the correct repository.
2. **Given** GitHub Desktop is not installed, **When** the user clicks "Open in GitHub Desktop", **Then** the app shows a message with a download link rather than a silent failure or crash.

---

### User Story 8 — Non-Dev: Changes Shared and PR Created Automatically (Priority: P1)

A non-technical user finishes working in a managed-mode session. The app pushes their task branch to the remote and creates a draft pull request on GitHub — all without the user needing to understand git remotes, push, or PR workflows. The session panel shows the PR status and any linked preview environment URLs (e.g., Probo).

**Why this priority**: This closes the loop between local task branch isolation and the team collaboration / environment provisioning workflow. Without it, managed-mode users are stranded on a local branch with no path to sharing their work or triggering preview environments.

**Independent Test**: Integration test — simulate a managed-mode session with committed changes; assert the branch is pushed to the remote; assert a draft PR is created via GitHub API; assert the session panel displays the PR URL and status.

**Acceptance Scenarios**:

1. **Given** a managed-mode session has committed changes and the user ends the session (or clicks "Share"), **When** the session close flow runs, **Then** the app pushes the task branch to the configured remote and creates a draft pull request on GitHub.
2. **Given** the draft PR is created, **When** the user views the session panel, **Then** the task branch entry shows the PR status (draft / open / merged) and a clickable link to the PR.
3. **Given** the remote repository has a Probo integration (or similar PR-triggered preview environment), **When** the PR is created and the preview environment is ready, **Then** the session panel displays the preview environment URL alongside the PR link.
4. **Given** a draft PR already exists for this task branch, **When** additional changes are pushed, **Then** the app updates the existing PR rather than creating a duplicate.
5. **Given** the push fails (network unavailable, authentication expired, permission denied), **When** the failure occurs, **Then** the app shows a plain-language message ("Could not share your work — check your internet connection") and queues a retry for next session open; no data is lost.
6. **Given** advisory mode is active, **When** the user ends a session with committed changes, **Then** the app suggests pushing and creating a PR but does not perform either action without explicit user confirmation.
7. **Given** managed mode and the repository has no configured remote, **When** the session close flow runs, **Then** the app skips the push/PR step silently and surfaces a suggestion to connect the repository to GitHub.

---

### Edge Cases

- **Concurrent sessions, same repo**: Two sessions open the same repository simultaneously. Each must receive a distinct, uniquely-named worktree. Neither session's changes appear in the other's context. (Covered by US-1, scenario 4.)
- **Subdirectory start**: A session starts in a subdirectory that is not the git root. The app must traverse up to find the git root before creating the worktree; the task branch is associated with the root, not the subdirectory.
- **Bare or corrupted repo**: Git repo is bare or corrupted. Task branch creation must fail gracefully with a plain-language message; the session continues without isolation rather than blocking the user.
- **Externally deleted worktree**: User manually deletes a worktree folder outside the app. On next panel load, the associated task branch is marked "broken" — not removed silently, not causing a crash. (Covered by US-3, scenario 3.)
- **Stale threshold adjustment**: Changing the threshold takes effect immediately on the next panel load without requiring an app restart. (Covered by US-4, scenario 6.)
- **Mode toggle**: Changing modes (managed ↔ advisory) takes effect for new sessions only; existing task branches retain the mode under which they were created. (Covered by US-3 scenario 2, US-6 scenarios 5 and 6.)
- **Branch lifecycle after deletion**: When a task branch is deleted from the panel, its underlying git branch is NOT automatically deleted. A post-delete prompt offers the option. Orphan branches are the user's responsibility beyond that prompt.
- **App crash mid-worktree-creation**: If the app or OS terminates during worktree creation, the partial worktree may be left on disk. On next start, the app detects any worktree in a partially-initialized state and marks the associated task branch "broken" rather than treating it as valid.
- **Non-git worktree naming collision**: Two task branches produced the same name (same date + mission slug). The second creation appends a counter (`-2`, `-3`, etc.) to ensure uniqueness. (Covered by US-1, scenario 5.)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: In managed mode, the app MUST create a named, isolated git worktree for a session on the first file modification within a git repository; no user action or confirmation is required. The file modification detection mechanism is an open architecture question resolved during planning.
- **FR-002**: Each task branch MUST be assigned a mission label: user-provided at session start if declared, or auto-inferred from the session's initial file context (path segments, file extensions, directory names) if not.
- **FR-003**: Drift detection MUST evaluate at minimum three signals: (a) count of distinct top-level directories touched, (b) count of inferred topic domains derived from file paths, and (c) elapsed session time. Default thresholds: 3 directories, 2 topic domains, 30 minutes. All thresholds MUST be configurable without restarting the app.
- **FR-004**: When two or more drift heuristic thresholds are exceeded simultaneously, the app MAY invoke an LLM to confirm the drift signal and generate a plain-language explanation. If the LLM is unavailable (offline, timeout, rate-limited), the heuristic-only signal MUST be used; the user MUST NOT be blocked or shown an LLM-specific error.
- **FR-005**: Drift intervention severity MUST scale with detection confidence: single-threshold breach produces a passive notification; two-threshold breach or LLM confirmation produces an assertive inline prompt offering to create a new session.
- **FR-006**: The session panel MUST display all app-managed task branches with: mission label, last activity timestamp, status (active / stale / merged / broken), and actions appropriate to each status. Status transitions: active→stale (threshold elapsed), active or stale→merged (underlying branch detected as merged into default branch), any→broken (worktree missing or corrupt on disk). Resuming a stale task branch transitions it back to active.
- **FR-007**: In managed mode, all git operations and all user-facing text MUST exclude words from the git terminology blocklist: branch, commit, hash, HEAD, checkout, merge, stash, worktree, ref, diff, push, pull, fetch, rebase, tag. No technical identifiers (branch names, hashes, file paths to `.git/`) SHALL be exposed unless the user explicitly requests them via a "show details" action.
- **FR-008**: In advisory mode, the app MUST NOT perform any git operation (worktree creation, branch creation, commit) without explicit user confirmation of a specific suggested action. This invariant MUST hold across all code paths and event types.
- **FR-009**: The app MUST support launching GitHub Desktop scoped to a task branch's underlying git branch and repository via the GitHub Desktop URL protocol. If GitHub Desktop is not installed, the app MUST show a download prompt rather than a silent failure.
- **FR-010**: Task branches with no activity beyond a configurable stale threshold (default: 14 days) MUST be flagged as stale. Threshold changes MUST take effect on the next panel load without an app restart.
- **FR-011**: Deleting a task branch with uncommitted changes MUST require explicit user confirmation with a plain-language warning; deleting a clean task branch requires no confirmation. After deletion, the app MUST prompt (but not require) the user to also delete the underlying git branch.
- **FR-012**: Users MUST be able to resume any task branch in non-broken status. Resumption MUST activate the worktree and surface the mission context. Resuming a stale task branch MUST clear the stale flag.
- **FR-013**: If a git worktree associated with a task branch is missing or corrupt on disk, the app MUST mark it "broken" on next load and offer cleanup, without crashing.
- **FR-014**: The operating mode (managed / advisory) MUST be configurable globally and overridable per repository. Mode changes take effect for new sessions only; the mode governing a task branch is determined at the time of creation and does not change when the global mode is toggled. Resuming a task branch in a different global mode retains the task branch's creation-time mode for UI and automation behavior.
- **FR-015**: Task branch metadata (mission label, status, mode, creation timestamp, last-activity timestamp, repository path, worktree path) MUST be persisted in a local SQLite store. This is new infrastructure; it does not extend the existing `replayCache` schema.
- **FR-016**: When a task branch creation event races with another creation in the same repository (concurrent sessions), each creation MUST produce a uniquely-named worktree. If a name collision would occur, the app MUST append a counter suffix to ensure uniqueness.
- **FR-017**: On app startup, the app MUST scan all persisted task branches and verify that their worktrees exist on disk. Any task branch whose worktree is missing or partially initialized MUST be immediately transitioned to "broken" status.
- **FR-018**: In managed mode, on session close or explicit "share" action, the app MUST push the task branch to the configured remote repository if there are committed changes. If the remote is unavailable, the app MUST queue the push for retry on next session open and surface a plain-language message — no data loss, no silent failure.
- **FR-019**: In managed mode, after a successful push, the app MUST create a draft pull request on GitHub if one does not already exist for that branch. If a PR already exists, subsequent pushes MUST NOT create duplicate PRs. PR creation uses the GitHub API via authenticated `gh` CLI or equivalent.
- **FR-020**: The TaskBranch entity MUST store an optional PR association: PR number, PR URL, PR status (draft / open / merged / closed), and an optional preview environment URL. The PR association is populated after FR-019 completes and updated on subsequent panel refreshes.
- **FR-021**: The session panel MUST display the associated PR status and preview environment URL (if available) for any task branch that has been pushed. Preview environment URLs are discovered by querying PR deployment statuses or check runs (e.g., Probo posts deployment URLs as GitHub deployment events).
- **FR-022**: In advisory mode, session close with committed changes MUST surface a suggestion to push and create a PR, but MUST NOT perform either action without explicit user confirmation. This extends the FR-008 invariant to remote operations.

### Key Entities

- **TaskBranch**: The core record managed by this feature. Represents one isolated git worktree tied to a session. Has a mission label, operating mode (managed / advisory), status (active / stale / merged / broken), creation timestamp, last-activity timestamp, repository path, worktree path, and optional PR association (PR number, PR URL, PR status, preview environment URL). Distinct from `WorkspaceRecord` in `packages/policy-client` (which is a multi-tenant control plane concept).
- **Session**: A Claude Code conversation instance. In managed mode, a session is associated with exactly one `TaskBranch` created lazily on first file modification. In advisory mode, a session may have a suggested `TaskBranch` that the user can accept. The persistent session entity with mission context is new infrastructure introduced by this feature; the existing `sessionId` field in policy enforcement is a separate, unrelated identifier.
- **Mission**: The declared or inferred purpose of a session. Used to label the `TaskBranch`, anchor drift comparison, and restore context on resumption. Auto-inferred from file path segments, directory names, and file extensions when not declared.
- **DriftSignal**: A detected divergence from the session's original mission. Has a confidence score (low / high), the specific heuristic thresholds that triggered it, and an optional LLM-generated plain-language explanation.
- **OperatingMode**: The configured interaction style for a session — managed (full automation, no git terminology) or advisory (observe-and-suggest, opt-in only). Stored per-TaskBranch at creation time; also configurable globally and per-repository for future sessions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Managed-mode users complete the full task branch lifecycle (create, work, resume, delete) without any word from the FR-007 git terminology blocklist appearing in any user-facing surface.
- **SC-002**: Drift detection fires within 10 file-touch events or 30 minutes after a measurable context switch (crossing default heuristic thresholds), whichever comes first, in 95% of defined test scenarios. The test scenario corpus is defined during planning with a minimum of 10 "should fire" and 5 "should not fire" cases.
- **SC-003**: Users can review all their task branches, identify stale ones, and complete a full cleanup of all stale clean task branches in under 60 seconds from panel open.
- **SC-004**: Resuming a prior task branch restores the session to active state and surfaces the mission label within 3 seconds of user action.
- **SC-005**: Advisory mode produces zero automatic git operations across all test scenarios; every git action is preceded by a logged user confirmation event.
- **SC-006**: GitHub Desktop launches scoped to the correct branch in 100% of launch attempts on machines where it is installed.
- **SC-007**: Broken task branch detection catches 100% of externally-deleted or partially-initialized worktrees on next app load and marks them correctly without a crash.
- **SC-008**: Batch cleanup with a mid-batch deletion failure removes all successfully deletable task branches and leaves failed ones visible in the panel with an error indicator — no silent partial failures.
- **SC-009**: In managed mode, task branches with committed changes result in a successful remote push and draft PR creation within 30 seconds of session close in 95% of attempts (network availability assumed).
- **SC-010**: PR association (number, URL, status) is visible in the session panel for 100% of task branches that have been pushed to a remote.
- **SC-011**: Preview environment URLs (e.g., Probo) appear in the session panel within 60 seconds of the environment becoming ready, as reported by GitHub deployment status events.

### Assumptions

- The desktop app has read/write access to the local git repositories it manages; permission issues are surfaced as task branch creation failures, not silent no-ops.
- GitHub Desktop's URL protocol is available on machines where GitHub Desktop is installed; the exact current protocol path is verified during planning before implementation.
- Drift detection default thresholds (FR-003) are defined in this spec as planning baselines; they are tunable by users and may be revised based on pilot feedback.
- In advisory mode, developers are assumed to have their own git workflow; the app's role is additive and non-authoritative.
- Task branch names use a human-readable convention (e.g., `YYYY-MM-DD-mission-slug`) so they are interpretable if a user inspects the filesystem directly.
- The LLM call for drift confirmation is optional and gracefully degraded — the feature must be fully functional without it.
- The new SQLite persistence layer (FR-015) follows the same patterns established by the `replayCache` in `packages/policy-client` but is a separate schema and store.
- The file modification detection mechanism (open architecture question) does not require changes to the Claude Code CLI itself; if IPC-based detection proves infeasible, filesystem watching is the fallback.
- GitHub authentication for push and PR creation uses the user's existing git credentials (SSH key or credential helper) and `gh` CLI authentication. The app does not manage its own GitHub OAuth flow for this purpose.
- Preview environment URL discovery relies on GitHub deployment status events or check run annotations. The app polls or receives webhooks for these; the exact mechanism is resolved during planning.
