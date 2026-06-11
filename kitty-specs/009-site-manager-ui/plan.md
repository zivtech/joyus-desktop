# Dashboard Architecture Plan: Site Manager Panel

**Branch**: `009-site-manager-ui` | **Date**: 2026-05-04 | **Spec**: [../007-local-remote-site-manager/spec.md](../007-local-remote-site-manager/spec.md)
**Input**: Existing Sites page (`Sites.tsx`), session management infrastructure, task branch store, environment monitor

## Summary

Evolve the existing Sites page into a full site manager panel with per-site task branch overview, worktree health indicators, file modification activity, site-level KPI aggregations, drill-down interaction, PR status integration, and quick actions. The implementation expands `Sites.tsx` in place (incremental migration, not a rewrite) and adds new leaf components for task branch details, site-level KPIs, and activity indicators. Two new IPC methods are required (`session.listByRepo` and `session.countsByRepo`); all other data comes from existing IPC commands and Tauri event subscriptions.

## Technical Context

**Language/Version**: TypeScript strict, ES2022, ESM (React 19, Tauri v2)
**UI Pattern**: Inline CSS with `style={{...}}` objects, card-based layout, 8px border-radius, `#e5e7eb` borders
**IPC Pattern**: `safeInvoke<T>(cmd, args)` for Tauri commands, `safeListen<T>(event, handler)` for event subscriptions
**Color Palette**: `#1a73e8` (primary), `#22c55e` (active/running), `#f59e0b` (warning/stale), `#ef4444` (error), `#6b7280` (muted), `#e5e7eb` (borders), `#f9fafb` (bg)
**Data Sources**: `TaskBranchStore` (SQLite), `LocalSiteManager`, `EnvironmentMonitor`, `FileModificationDetector`, `DriftDetector`
**Join Key**: `TaskBranch.repoPath` matches `LocalSite.repoPath` -- this is how task branches are associated with sites
**Existing IPC Methods**: `session.list`, `session.resume`, `session.delete`, `session.hasUncommittedChanges`, `session.getMode`, `session.setMode`, `session.fileModified`, `site_list_local`, `site_list_remote`, `site_start`, `site_stop`, `site_restart`, `site_remove`, `site_provision`
**Existing Events**: `state.driftSignal`, `state.serverChanged`, `state.syncCompleted`, `state.error`

---

## 1. Information Architecture

### 1.1 KPI Hierarchy

The panel presents three tiers of data, from high-level summary to granular detail:

**Tier 1 -- Page-Level Summary** (always visible at top)
- Site status distribution: counts of running, starting, stopped, error sites. Items with zero count omitted.

**Tier 2 -- Site Card** (one per site, collapsed by default)
- Site identity: project name, repo path, DDEV project name
- Site status: running / stopped / starting / error (existing dot indicator)
- Task branch count badge: `N active` / `N total` branches for this site
- Last activity timestamp: most recent `lastActivityAt` across all branches for this repo
- PR summary: count of branches with associated PRs
- Quick actions: start / stop / restart / open / remove (existing)

**Tier 3 -- Expanded Site Detail** (shown on card expansion)
- Per-branch rows: branch name, mission label, status dot, relative time, PR link
- Worktree health: status indicator per branch (active / stale / merged / broken)
- File modification activity: last modified timestamp per branch
- Drift warnings: inline banner when drift signal confidence is "high"
- Remote environments: linked Probo/Joyus AI environments for this repo
- Branch quick actions: resume, delete, open in GitHub

### 1.2 Content Zones

```
+---------------------------------------------------------------+
|  HEADER: "Sites" + total count + active branches count        |
+---------------------------------------------------------------+
|  KPI BAR: [* N Running] [* N Starting] [* N Stopped] [* N Error]  |
+---------------------------------------------------------------+
|  NEW SITE: [provision form -- existing]                       |
+---------------------------------------------------------------+
|  SECTION: Local Sites (N)                                     |
|  +-----------------------------------------------------------+
|  | SiteCard: project-alpha                                    |
|  |   Running  |  3 branches (2 active)  |  5 min ago          |
|  |   [Start] [Stop] [Restart] [Open] [Remove]  [v expand]    |
|  +-----------------------------------------------------------+
|  | EXPANDED:                                                  |
|  |   BranchRow: feat/login    Active   2 min   PR #42         |
|  |   BranchRow: fix/header    Stale    3 hrs   --             |
|  |   BranchRow: refactor/nav  Merged   1 day   PR #38         |
|  |   DriftBanner: "Topic drift detected on feat/login"        |
|  |   RemoteEnvRow: Probo env for PR #42 -- Active             |
|  +-----------------------------------------------------------+
|  | SiteCard: project-beta     (collapsed)                     |
|  +-----------------------------------------------------------+
|                                                               |
|  SECTION: Remote Environments (N)                             |
|  +-----------------------------------------------------------+
|  | RemoteEnvironmentCard (existing, unchanged)                |
|  +-----------------------------------------------------------+
+---------------------------------------------------------------+
```

### 1.3 Drill-Down Flow

1. **Page load**: Fetch `site_list_local`, `site_list_remote`, and `session.countsByRepo` in parallel. Render Tier 1 KPIs and collapsed Tier 2 cards.
2. **Card expand**: On expand click, fetch `session.listByRepo({ repoPath })` for the specific site. Render Tier 3 branch rows, drift state, and remote environment links.
3. **Branch action**: Resume navigates to Sessions page (or triggers `session.resume` inline). Delete invokes `session.delete` with uncommitted changes check. Open GitHub constructs URL from `repoPath + branchName`.
4. **Real-time updates**: Subscribe to `state.driftSignal` on mount. When a signal arrives for a branch belonging to an expanded site, update that card's drift banner in place.

### 1.4 Data Canonical Sources

| Data Point | Canonical Source | Rationale |
|---|---|---|
| Site status (running/stopped) | `LocalSite.status` via `site_list_local` | Site lifecycle is managed by local-provisioner |
| Branch status (active/stale/merged/broken) | `TaskBranch.status` via `session.list` / `session.listByRepo` | TaskBranchStore is the single source of truth |
| PR association at branch level | `TaskBranch.prNumber/prUrl/prTitle` | Written by event bridge when PR is created |
| PR association at remote env level | `RemoteEnvironment.prNumber/prUrl/prTitle` | Written by environment monitor from GitHub Deployments API |
| File modification recency | `TaskBranch.lastActivityAt` | Updated by FileModificationDetector via session manager. File modification activity is derived from `TaskBranch.lastActivityAt` via 30s polling, not real-time events. |
| Drift signal | `state.driftSignal` event | Emitted by DriftDetector, consumed as Tauri event |
| Worktree health | `TaskBranch.status === "broken"` | Set by `scanIntegrity()` in TaskBranchStore |

**RemoteEnvironment-to-LocalSite join key strategy**: Parse `LocalSite.repoUrl` to extract `owner/name` (strip trailing `.git`, split on last two path segments) and match against `RemoteEnvironment.repoOwner`/`RemoteEnvironment.repoName`. Edge cases: SSH URLs (`git@github.com:owner/name.git`) require different parsing than HTTPS. Use the `parseRepoIdentity(url: string): { owner: string; name: string } | undefined` utility added in WP-4.

---

## 2. Component Decomposition

### 2.1 New Components

**`AggregateHealthBar`** -- Page-level status distribution strip
- Inline in `Sites.tsx` -- no separate component file needed
- Compact flex row of status dots with counts (e.g., "3 Running * 1 Starting"). Items with zero count omitted.
- Position: between page header and provision form

**`SiteCardExpanded`** -- Expanded detail panel within a LocalSiteCard
- Props: `{ site: LocalSite; branches: TaskBranch[]; remoteEnvs: RemoteEnvironment[]; driftSignals: Map<string, DriftSignalPayload>; onResume: (id: string) => void; onDeleteBranch: (id: string) => void; onOpenGitHub: (repoPath: string, branchName: string) => void; onDismissDrift: (taskBranchId: string) => void }`
- `onDismissDrift`: removes the signal from the drift signals map in `Sites` page state. "Start Fresh Task" navigates to `/` (Dashboard), matching Sessions page behavior.
- Renders `BranchRow` for each task branch, `DriftBanner` for high-confidence signals, and linked `RemoteEnvRow` instances
- Position: rendered inside `LocalSiteCard` below the action buttons when expanded

**`BranchRow`** -- Compact single-line branch representation for site detail view
- Props: `{ branch: TaskBranch; driftSignal?: DriftSignalPayload; onResume: (id: string) => void; onDelete: (id: string) => void; onOpenGitHub: (repoPath: string, branchName: string) => void }`
- Displays: branch name (monospace), mission label (truncated), status dot + label, relative time, PR link (if present), action buttons
- Reuses `STATUS_COLORS` and `STATUS_LABELS` from TaskBranchCard.tsx, `formatRelativeTime` utility

**`RemoteEnvRow`** -- Compact remote environment line for site detail view
- Props: `{ env: RemoteEnvironment }`
- Displays: environment type badge, status dot, PR link, environment URL link
- Simpler than full `RemoteEnvironmentCard` -- single-line, no last-checked timestamp

**`BranchCountBadge`** -- Inline badge showing branch counts on collapsed site cards
- Props: `{ active: number; total: number }`
- Renders: `"2 active / 5 total"` with active count in green when > 0

**`SiteActivityIndicator`** -- Last-activity timestamp with relative time formatting
- Props: `{ lastActivityAt: number | undefined }`
- Renders: relative time string or em-dash if no activity

### 2.2 Modified Components

**`LocalSiteCard`** (existing, modified)
- Add `expanded` state (boolean, default false)
- Add expand/collapse toggle button (chevron) to the action button row
- When expanded, render `SiteCardExpanded` below the existing content
- Add `BranchCountBadge` to the right side of the name/status row
- Add `SiteActivityIndicator` below the repo path
- New props: `branchCounts: { active: number; total: number }; lastActivityAt: number | undefined`

**`Sites`** (existing page, modified)
- Add `AggregateHealthBar` inline between header and provision form (no separate component file)
- Add `session.countsByRepo` IPC call on mount (parallel with existing loads)
- Add `safeListen("state.driftSignal", handler)` subscription on mount
- Store drift signals in a `Map<string, DriftSignalPayload>` keyed by `taskBranchId`
- Compute per-site branch counts and last activity from counts response
- Pass branch counts and last activity down to each `LocalSiteCard`

### 2.3 Reused Without Changes

- `ProvisionForm` -- reused as-is for new site provisioning
- `Section` -- reused as-is for section wrappers
- `SkeletonCard` -- reused as-is for loading states
- `RemoteEnvironmentCard` -- reused as-is in the Remote Environments section
- `ActionButton` -- reused as-is from LocalSiteCard for branch-level actions
- `DriftBanner` -- reused as-is for inline drift warnings (already exists as a component)
- `formatRelativeTime` -- extract from TaskBranchCard into a shared utility, reuse in `BranchRow` and `SiteActivityIndicator`

### 2.4 Data Flow

```
Sites (page)
  |-- safeInvoke("site_list_local")    --> localSites[]
  |-- safeInvoke("site_list_remote")   --> remoteSites[]
  |-- safeInvoke("session.countsByRepo") --> branchCountsMap
  |-- safeListen("state.driftSignal")  --> driftSignals Map
  |
  |-- AggregateHealthBar (derived from localSites, inline in Sites.tsx)
  |-- ProvisionForm (unchanged)
  |
  |-- Section "Local Sites"
  |   |-- LocalSiteCard (per site)
  |       |-- BranchCountBadge (from branchCountsMap[site.repoPath])
  |       |-- SiteActivityIndicator (from branchCountsMap[site.repoPath])
  |       |-- [expand toggle]
  |       |-- SiteCardExpanded (when expanded)
  |           |-- safeInvoke("session.listByRepo", { repoPath })  --> branches[]
  |           |-- BranchRow (per branch)
  |           |   |-- DriftBanner (if driftSignals.has(branch.id))
  |           |-- RemoteEnvRow (filtered from remoteSites by matching repo)
  |
  |-- Section "Remote Environments"
      |-- RemoteEnvironmentCard (per env, unchanged)
```

---

## 3. IPC Commands Needed

### 3.1 New IPC Methods

**`session.listByRepo`** -- List task branches filtered by repo path
- **Request**: `{ repoPath: string }`
- **Response**: `TaskBranch[]`
- **Implementation**: Add a `findByRepoPath(repoPath)` method to `TaskBranchStore` that queries non-deleted branches matching the given repo path, ordered by last activity descending. The existing `idx_task_branches_repo_path` index makes this a fast indexed lookup. Register the method in `registerSessionMethods()` with a parameter parser that requires a non-empty `repoPath` string.
- **Rationale**: Avoids fetching all branches and filtering client-side on every card expansion. The `repo_path` index already exists in the schema.

**`session.countsByRepo`** -- Aggregated branch counts per repo path
- **Request**: `{}` (no params)
- **Response**: A map keyed by `repoPath`, where each value contains the active branch count, total branch count, and most recent activity timestamp for that repo.
- **Implementation**: Add a `countsByRepo()` method to `TaskBranchStore` that runs a single aggregation query grouping non-deleted branches by `repo_path`, counting total rows, summing active-status rows, and taking the max `last_activity_at` per group. Returns the result as a plain object map.
- **Rationale**: Collapsed site cards need branch counts without fetching full branch data for every site. A single aggregation query is far cheaper than N `findByRepoPath` calls on page load.

### 3.2 Existing IPC Methods Used

| Method | Used For | Called When |
|---|---|---|
| `site_list_local` | Load all local sites | Page mount |
| `site_list_remote` | Load all remote environments | Page mount |
| `site_start` | Start a local site | Quick action button |
| `site_stop` | Stop a local site | Quick action button |
| `site_restart` | Restart a local site | Quick action button |
| `site_remove` | Remove a local site | Quick action button |
| `site_provision` | Provision new site from repo URL | Provision form submit |
| `session.list` | Fallback if `session.listByRepo` unavailable | -- |
| `session.resume` | Resume a task branch session | Branch quick action |
| `session.delete` | Delete a task branch | Branch quick action |
| `session.hasUncommittedChanges` | Check before branch delete | Before delete confirmation |

### 3.3 Event Subscriptions

| Event | Payload | Used For |
|---|---|---|
| `state.driftSignal` | `DriftSignalPayload { taskBranchId, confidence, heuristics, explanation }` | Show drift warnings on expanded site cards |

### 3.4 Data Shapes (New/Extended)

**BranchCountsMap** (response from `session.countsByRepo`)

| Field | Type | Notes |
|---|---|---|
| `[repoPath]` | object (keyed by repo path string) | One entry per repo that has branches |
| `.active` | number | Count of branches with status "active" |
| `.total` | number | Count of all non-deleted branches |
| `.lastActivityAt` | number | Most recent `lastActivityAt` across all branches for this repo (epoch ms) |

**Extended LocalSiteCard props** (additions to existing props)

| Prop | Type | Notes |
|---|---|---|
| `branchCounts` | `{ active: number; total: number }` or undefined | Omitted when counts data is unavailable |
| `lastBranchActivity` | number or undefined | Most recent branch activity timestamp for this site's repo |
| `expanded` | boolean | Whether the card's detail panel is visible |
| `onToggleExpand` | callback | Invoked when the expand/collapse chevron is clicked |

**SiteCardExpanded props**

| Prop | Type | Notes |
|---|---|---|
| `site` | LocalSite | The parent site for context |
| `branches` | TaskBranch array | Pre-fetched branches for this site's repo path |
| `remoteEnvs` | RemoteEnvironment array | Filtered to environments matching this site's repo |
| `driftSignals` | Map keyed by taskBranchId | Drift signals received via event subscription |
| `onResume` | callback(id) | Resume a task branch session |
| `onDeleteBranch` | callback(id) | Delete a task branch |
| `onOpenGitHub` | callback(repoPath, branchName) | Open branch on GitHub |

---

## 4. Interaction Design

### 4.1 Expand/Collapse

- Each `LocalSiteCard` has a chevron toggle in the action button row (rightmost position)
- Click toggles `expanded` boolean state
- Chevron rotates 180 degrees when expanded (CSS transform, no animation library)
- Only one site can be expanded at a time (accordion behavior) -- managed by `Sites` page via `expandedSiteId` state
- Expanding a card triggers `session.listByRepo` fetch; results are cached until the card is collapsed or a refresh event occurs
- Keyboard: chevron is a `<button>` with `aria-expanded` and `aria-controls`
- **Cleanup on site removal**: When `localSites` is updated (from polling or after a remove action), if `expandedSiteId` does not match any site in the updated list, reset it to `undefined`.

### 4.2 Filtering and Sorting

**Phase 1 (MVP)**: No explicit filter/sort controls. Sites are displayed in the order returned by `site_list_local` (alphabetical by project name). Task branches within an expanded card are sorted by `lastActivityAt` descending (most recent first) -- this is the default order from the SQL query.

**Phase 2 (future)**: Add a filter bar above the Local Sites section:
- Filter by status: All / Running / Stopped / Error
- Filter by activity: All / Active branches / No branches
- Sort by: Name / Last activity / Status
- These are client-side filters on already-fetched data

### 4.3 Quick Actions

**Site-level** (existing, unchanged):
- Start: enabled when `status === "stopped" || status === "error"`, calls `site_start`
- Stop: enabled when `status === "running"`, calls `site_stop`
- Restart: enabled when `status === "running"`, calls `site_restart`
- Open: enabled when `httpsUrl || httpUrl` exists, opens in browser
- Remove: always enabled (with confirmation), calls `site_remove`

**Branch-level** (new, in expanded view):
- Resume: enabled when `status === "active" || status === "stale"`, calls `session.resume`
- Delete: always enabled, calls `session.hasUncommittedChanges` first; if true, shows warning in confirmation dialog; calls `session.delete` with `{ force: true }` if confirmed
- Open GitHub: enabled always, constructs GitHub URL from `repoPath` + `branchName`, opens in browser via `@tauri-apps/plugin-shell` open

### 4.4 Empty States

| Context | Message | Visual |
|---|---|---|
| No local sites | "No local sites. Provision a project to see it here." | Dashed border box, muted text (existing) |
| No remote environments | "No remote environments detected." | Dashed border box, muted text (existing) |
| Site expanded, no branches | "No task branches for this site." | Muted text inside expanded area, no dashed border |
| Site expanded, no remote envs | Section simply not rendered (no empty state) | -- |
| All KPIs zero | KPI bar renders with "0" values, no special empty state | Normal rendering |

### 4.5 Loading States

| Context | Indicator |
|---|---|
| Page initial load | `SkeletonCard` placeholders in each section (existing pattern) |
| KPI bar loading | KPI values show "--" placeholder while `anyLoading` is true |
| Card expansion loading | Inline spinner below the action buttons while `session.listByRepo` is in flight |
| Branch action pending | `ActionButton` shows spinner and disables (existing pattern from `LocalSiteCard`) |

### 4.6 Error States

| Context | Display |
|---|---|
| `site_list_local` fails | Red error box in Local Sites section (existing pattern) |
| `session.countsByRepo` fails | KPI bar shows "--" for branch-related values; cards omit branch counts; no blocking error |
| `session.listByRepo` fails | Red error box inside expanded card area |
| Branch resume fails with "broken" | Inline error message on the branch row, auto-dismiss after 5 seconds |
| Branch delete fails with "uncommitted_changes" | Confirmation dialog with warning text (existing pattern from Sessions page) |

### 4.7 Real-Time Updates

- **Drift signals**: `safeListen("state.driftSignal", handler)` subscribed on `Sites` page mount. Signals are stored in a `Map<string, DriftSignalPayload>` keyed by `taskBranchId`. When a signal arrives for a branch belonging to an expanded site, the drift banner appears immediately without re-fetching.
- **Site status changes**: Not event-driven in the current architecture. The page relies on the data loaded at mount time. A manual refresh button in the page header (or periodic polling at 30s intervals matching Dashboard.tsx pattern) can be added in Phase 2.
- **Branch activity updates**: The `lastActivityAt` field is updated server-side by the file modification detector. To reflect this in real-time, the `session.countsByRepo` response can be re-fetched on a 30-second interval (same pattern as Dashboard's `useUsageSummary` hook).

---

## 5. Implementation Sequence

### Phase 1: Backend -- New Store Methods and IPC (no UI changes)

**WP-1: `findByRepoPath` store method**
- Add `findByRepoPath(repoPath: string): readonly TaskBranch[]` to `TaskBranchStore` interface
- Add prepared statement using existing `idx_task_branches_repo_path` index
- Add unit tests
- Files: `packages/session-manager/src/taskBranchStore.ts`, `packages/session-manager/test/taskBranchStore.test.ts`

**WP-2: `countsByRepo` store method**
- Add `countsByRepo(): Record<string, { active: number; total: number; lastActivityAt: number }>` to `TaskBranchStore` interface
- Single SQL with `GROUP BY repo_path` aggregation
- Add unit tests
- Files: `packages/session-manager/src/taskBranchStore.ts`, `packages/session-manager/test/taskBranchStore.test.ts`

**WP-3: IPC method registration**
- Register `session.listByRepo` and `session.countsByRepo` in `registerSessionMethods()`
- Add parameter parsing functions (`extractRequiredRepoPath`)
- Add to `SessionWiring` type if needed
- Files: `apps/desktop-companion/src/sidecar/services.ts`

**WP-3b: Rust Tauri command wrappers**
- Add `session_list_by_repo` and `session_counts_by_repo` functions in `commands.rs`
- Register both in `main.rs` `invoke_handler` via `tauri::generate_handler!`
- Follow existing pattern from `site_list_local` (call `state.send_request(...)`)
- Files: `apps/desktop-companion/src-tauri/src/commands.rs`, `apps/desktop-companion/src-tauri/src/main.rs`

### Phase 2: Shared Utilities

**WP-4: Extract `formatRelativeTime` utility and add `parseRepoIdentity`**
- Extract `formatRelativeTime()` from `TaskBranchCard.tsx` into a shared utility file
- Update `TaskBranchCard.tsx` to import from the shared location
- Add `parseRepoIdentity(url: string): { owner: string; name: string } | undefined` utility for RemoteEnvironment-to-LocalSite joining. Strip trailing `.git`, split on last two path segments. Handle both HTTPS (`https://github.com/owner/name.git`) and SSH (`git@github.com:owner/name.git`) URL formats.
- Define `@keyframes pulse` and `@keyframes spin` in a global CSS file (`apps/desktop-companion/src/ui/global.css` imported in `main.tsx`). Currently `@keyframes spin` exists only in `Onboarding.tsx` (scoped) and `@keyframes pulse` is undefined globally — both are silently broken on other pages. This is a pre-existing bug being fixed as part of this work.
- File: `apps/desktop-companion/src/ui/utils/formatTime.ts`, `apps/desktop-companion/src/ui/utils/repoIdentity.ts`, `apps/desktop-companion/src/ui/global.css`

**WP-4b: Sync frontend `TaskBranch` interface**
- Add optional `prNumber`, `prUrl`, `prTitle` fields to the `TaskBranch` interface in `TaskBranchCard.tsx`
- These fields exist in the backend `taskBranchStore.ts` but are missing from the frontend type
- Prerequisite for WP-7 (BranchRow needs PR data)
- Files: `apps/desktop-companion/src/ui/components/TaskBranchCard.tsx`

### Phase 3: Leaf Components (no existing component changes)

**WP-5: `BranchCountBadge` component**
- New file: `apps/desktop-companion/src/ui/components/BranchCountBadge.tsx`
- Compact inline badge: `"2 active / 5 total"` or `"No branches"`

**WP-6: `SiteActivityIndicator` component**
- New file: `apps/desktop-companion/src/ui/components/SiteActivityIndicator.tsx`
- Uses shared `formatRelativeTime`, renders relative time or em-dash

**WP-7: `BranchRow` component**
- New file: `apps/desktop-companion/src/ui/components/BranchRow.tsx`
- Single-line branch representation with status dot, mission label, relative time, PR link, action buttons
- Reuses `STATUS_COLORS`/`STATUS_LABELS` from `TaskBranchCard.tsx` (extract to shared constants if needed)
- Imports `DriftBanner` for inline drift warnings

**WP-8: `RemoteEnvRow` component**
- New file: `apps/desktop-companion/src/ui/components/RemoteEnvRow.tsx`
- Compact single-line remote environment: type badge, status dot, PR link, env URL

**WP-9: `SiteCardExpanded` component**
- New file: `apps/desktop-companion/src/ui/components/SiteCardExpanded.tsx`
- Composes `BranchRow` and `RemoteEnvRow`
- Handles empty state for no branches
- Accepts pre-fetched branches and remote envs as props (no internal data fetching)

**WP-10: `AggregateHealthBar` (inline in Sites.tsx)**
- Inline health bar in `Sites.tsx` -- flex row of status dots with counts. No separate component file needed.
- Shows counts of running, starting, stopped, error sites. Items with zero count omitted.
- Matches design spec compact dot-count layout

### Phase 4: Integration (modify existing components)

**WP-11: Extend `LocalSiteCard` with expand/collapse and badges**
- Add `expanded`, `onToggleExpand` props
- Add `branchCounts`, `lastBranchActivity` props
- Render `BranchCountBadge` in the name/status row
- Render `SiteActivityIndicator` below repo path
- Add chevron toggle button to action row
- When expanded, render `SiteCardExpanded` below action buttons
- Fetch branches on expand via callback prop (data fetching stays in Sites page)

**WP-12: Extend `Sites` page with KPIs, branch counts, drift subscription, and accordion**
- Add `session.countsByRepo` IPC call on mount (parallel with existing loads)
- Add `safeListen("state.driftSignal", handler)` subscription
- Add `expandedSiteId` state for accordion behavior
- Add `handleExpand(siteId)` that fetches `session.listByRepo` and stores result
- Add `AggregateHealthBar` inline between header and provision form
- Pass `branchCounts`, `lastBranchActivity`, `expanded`, `onToggleExpand` to each `LocalSiteCard`
- Pass fetched branches, filtered remote envs, and drift signals to expanded card

### Phase 5: Polish and Edge Cases

**WP-13: Accordion keyboard accessibility**
- Chevron trigger: `<button aria-expanded="true|false" aria-controls="site-detail-{siteId}">` (native `<button>` — `role="button"` not needed)
- Expanded panel: `<div id="site-detail-{siteId}" role="region" aria-labelledby="site-name-{siteId}">`
- Site name: `<span id="site-name-{siteId}">`
- Cards themselves are NOT focusable — the chevron button handles all keyboard interaction
- Escape on an expanded panel collapses it and returns focus to the chevron
- Reference: WAI-ARIA Disclosure (Show/Hide) pattern

**WP-14: Loading and error edge cases**
- Handle `session.countsByRepo` failure gracefully (cards render without branch counts)
- Handle `session.listByRepo` failure with inline error in expanded card
- Handle branch resume "broken" error with inline message

**WP-15: 30-second periodic refresh for branch counts**
- Add `useInterval` or `useEffect` with `setInterval` for `session.countsByRepo` refresh
- Match Dashboard.tsx polling pattern (30s interval)
- Only refresh when page is visible (skip when tab is hidden)
- After a branch resume or delete action completes, re-fetch `session.listByRepo` for the expanded site to update the branch list. Also re-fetch `session.countsByRepo` to update collapsed card badges.

**WP-16: Frontend component tests**
- Unit tests for all new/modified UI components: `AggregateHealthBar` (inline), `BranchCountBadge`, `SiteActivityIndicator`, `BranchRow`, `RemoteEnvRow`, `SiteCardExpanded`
- Tests for modified `LocalSiteCard` expand/collapse behavior
- Tests for `Sites` page integration (IPC mocking, accordion state, drift signal handling)
- Project enforces 100% coverage -- all branches must be covered
- Files: `apps/desktop-companion/test/ui/components/*.test.tsx`, `apps/desktop-companion/test/ui/pages/Sites.test.tsx`

---

## Architecture Decisions

### AD-1: Server-Side Filtering via `session.listByRepo`

Fetch branches per-site on demand rather than loading all branches at page mount and filtering client-side. The `repo_path` index already exists in SQLite (`idx_task_branches_repo_path`), making this a fast indexed query. This avoids O(sites * branches) client-side filtering and scales better as the number of branches grows.

Alternative considered: Client-side filter of `session.list` results. Rejected because it loads all branches into memory on every page mount, even when most cards are collapsed.

### AD-2: `session.countsByRepo` for Collapsed Card Summaries

A dedicated aggregation query for branch counts avoids fetching full `TaskBranch` objects for all sites on page load. The collapsed card only needs three numbers per repo (active count, total count, last activity timestamp). This keeps the initial page load lightweight.

Alternative considered: Fetch all branches via `session.list` and compute counts client-side. Rejected for the same scalability reason as AD-1.

### AD-3: Accordion (Single Expanded Card)

Only one site card can be expanded at a time. This simplifies state management (single `expandedSiteId` vs. `Set<string>`), avoids multiple simultaneous `session.listByRepo` fetches, and prevents the page from becoming overwhelmingly long with multiple expanded panels.

Alternative considered: Multiple simultaneous expansions. Deferred to Phase 2 if user feedback requests it.

### AD-4: Incremental Migration of Sites.tsx

The existing `Sites` page is expanded in place rather than replaced. New props are added to `LocalSiteCard` with optional defaults so the card continues to function without branch data. This avoids a risky big-bang rewrite and allows each work package to be shipped and tested independently.

### AD-5: Drift Signal Subscription at Page Level

The `state.driftSignal` event subscription is managed by the `Sites` page component, not individual `BranchRow` components. This avoids N event listeners for N branches and provides a single map that can be passed down through props. When a drift signal arrives, only the relevant expanded card re-renders.

### AD-6: PR Data Source by Context

At the branch detail level (BranchRow), PR data comes from `TaskBranch.prNumber/prUrl/prTitle` -- this is set by the event bridge when a PR is created during session close. At the remote environment level (RemoteEnvRow), PR data comes from `RemoteEnvironment.prNumber/prUrl/prTitle` -- this is set by the environment monitor from GitHub Deployments API. Both sources are authoritative in their own context and do not conflict.

### AD-7: No New Event for File Modification Activity

File modification recency is derived from `TaskBranch.lastActivityAt`, which is already updated by the `FileModificationDetector` through the session manager. A new `state.fileModification` Tauri event is not needed because the 30-second polling refresh of `session.countsByRepo` (WP-15) is sufficient granularity for the UI. Real-time per-keystroke updates would add complexity with no meaningful UX benefit.

---

## Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| `session.listByRepo` adds latency to card expansion | Low | Query uses existing `repo_path` index; expected <5ms for typical branch counts |
| Accordion UX feels restrictive for power users | Medium | Ship as Phase 1 MVP; collect feedback; expanding to multi-select is a state change from `string` to `Set<string>` |
| Drift signals accumulate in memory for long-running sessions | Low | Clear drift signal map on page unmount; signals are small objects |
| Branch count polling (30s) creates unnecessary load | Low | `countsByRepo` is a single aggregation query; skip refresh when tab is not visible |
| `formatRelativeTime` extraction creates merge conflicts | Low | Extract in a dedicated WP before any component changes; small diff |
| `TaskBranch` interface in `TaskBranchCard.tsx` is missing `prNumber/prUrl/prTitle` fields that exist in `taskBranchStore.ts` | High | Must sync the frontend `TaskBranch` interface to include these three optional fields before WP-7 (BranchRow) can display PR links. This is a prerequisite for WP-7 and is addressed by WP-4b (frontend interface sync). The Sessions page (`TaskBranchCard`) will also benefit from this fix. |
| Sites page becomes too long with expanded cards | Medium | Accordion behavior (AD-3) limits to one expanded card; consider max-height with scroll on expanded panel if content exceeds viewport |

---

## Dependency Map

```
WP-1 (findByRepoPath) ──┐
WP-2 (countsByRepo) ────┤
                         ├── WP-3 (IPC registration) ── WP-3b (Rust Tauri wrappers) ──┐
WP-4 (formatRelativeTime/parseRepoIdentity/global.css)─────────────────────────────────┤
WP-4b (TaskBranch interface sync) ─────────────────────────────────────────────────────┤
                                                                                        │
WP-5  (BranchCountBadge)  ──┐                                                          │
WP-6  (SiteActivityIndicator)┤                                                         │
WP-7  (BranchRow)          ──┤  (requires WP-4b)                                       │
WP-8  (RemoteEnvRow)       ──┤                                                          │
WP-10 (AggregateHealthBar)  ─┤                                                          │
                              ├── WP-9 (SiteCardExpanded)                               │
                              │                                                          │
                              └── WP-11 (LocalSiteCard) ──────────────────────────────┤
                                                                                        ├── WP-12 (Sites page integration)
                                                                                        │
                                                                                        ├── WP-13 (a11y)
                                                                                        ├── WP-14 (error handling)
                                                                                        ├── WP-15 (periodic refresh)
                                                                                        └── WP-16 (frontend tests)
```

Work packages within the same phase can be parallelized. Cross-phase dependencies flow strictly downward.
