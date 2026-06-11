# Site Manager Panel -- UI Design Specification

Spec: `009-site-manager-ui`
Status: Draft
Last updated: 2026-05-04

---

## 1. Layout Strategy

### Page Structure

The Site Manager Panel replaces the current `Sites` page at `/sites`. It operates within the existing Layout shell: 200px fixed sidebar on the left, 1.5rem-padded main content area on the right, 28px status bar at the bottom. Minimum content width is 600px (800px window min minus 200px sidebar).

The page uses a single-column stacked layout, consistent with the Sessions and Dashboard pages. No split panes, no routed detail views, no tabs. All content scrolls vertically within the `<main>` overflow-auto container.

### Vertical Sections (top to bottom)

```
+------------------------------------------------------------------+
| Page Header: "Sites" + aggregate count                           |
+------------------------------------------------------------------+
| Aggregate Health Bar (colored dots with counts)                  |
+------------------------------------------------------------------+
| Provision Form (existing, always visible)                        |
+------------------------------------------------------------------+
| Section: Local Sites                                             |
|   [ LocalSiteCard -- collapsed ]                                 |
|   [ LocalSiteCard -- expanded, showing TaskBranch rows ]         |
|   [ LocalSiteCard -- collapsed ]                                 |
+------------------------------------------------------------------+
| Section: Remote Environments                                     |
|   [ RemoteEnvironmentCard ]                                      |
|   [ RemoteEnvironmentCard ]                                      |
+------------------------------------------------------------------+
```

### Spacing

- Page-level vertical gap between sections: `1.5rem` (matches Sessions page)
- Card-to-card gap within a section: `0.5rem` (matches existing Sites page)
- Section header to first card: `0.75rem` (matches Section component)

---

## 2. Visual Hierarchy

### Page Header

Follows the exact pattern from the current Sites page:

```
h1: fontSize 1.5rem, fontWeight 700, color #111827, margin 0
subtitle: margin 0.25rem 0 0, fontSize 0.875rem, color #6b7280
```

The subtitle shows total site count: `"{N} sites"` (or `"1 site"`). Displayed only after both local and remote loading complete (same as current).

### Aggregate Health Bar

A compact summary row directly below the page header. Provides at-a-glance health without requiring the user to scan every card.

```
+-----------------------------------------------------------------+
| * 3 Running   * 1 Starting   * 2 Stopped   * 1 Error            |
+-----------------------------------------------------------------+
```

Layout:
- Container: `display: flex`, `gap: 1rem`, `flexWrap: wrap`, `padding: 0.5rem 0`
- Each item: `display: inline-flex`, `alignItems: center`, `gap: 0.375rem`
- Dot: 8px circle using existing STATUS_COLORS palette
- Text: `fontSize: 0.813rem`, `color: #374151`, `fontWeight: 500`

Only shown when `!loading && error === undefined`. Items with count 0 are omitted.

Colors (reconciled -- StatusBadge.tsx is the canonical source):
- Running: `#22c55e`
- Stopped: `#94a3b8`
- Starting: `#f59e0b`
- Error: `#ef4444`

Note: `LocalSiteCard` currently uses `#6b7280` for stopped. This spec standardizes on `#94a3b8` from `StatusBadge.tsx` across all site-related status indicators. The implementer should update `LocalSiteCard`'s `STATUS_COLORS.stopped` to `#94a3b8` as part of the LocalSiteCard extension (WP-11).

### Section Headers

Reuse the existing `Section` component pattern from Sites.tsx:

```
h2: margin 0, fontSize 1.125rem, fontWeight 600, color #111827
count badge: fontSize 0.875rem, fontWeight 400, color #6b7280, marginLeft 0.5rem
```

The count badge `(N)` appears only when `!loading && error === undefined`.

### Information Density Tiers

1. **Aggregate Health Bar** -- scan in under 1 second. Status distribution across all sites.
2. **Collapsed LocalSiteCard** -- scan in 2-3 seconds per card. Name, status, repo path, task count.
3. **Expanded LocalSiteCard** -- full detail on demand. Task branches, drift signals, action buttons.

---

## 3. Component Specifications

### 3.1 LocalSiteCard (Collapsed State)

The collapsed card is the default view for each local site. It shows enough information to decide whether to expand.

```
+------------------------------------------------------------------+
| [project-name]                        [*] Running    [v] 3 tasks |
| /path/to/repo                                        [>]         |
+------------------------------------------------------------------+
```

#### Container
```
border: 1px solid #e5e7eb
borderRadius: 8px
padding: 0.875rem 1rem
background: #fff
display: flex
flexDirection: column
gap: 0.375rem
```

#### Header Row (first line)

```
display: flex
justifyContent: space-between
alignItems: center
gap: 0.5rem
```

Left side:
- Project name: `fontWeight: 600`, `fontSize: 0.938rem`, `color: #111827`, `overflow: hidden`, `textOverflow: ellipsis`, `whiteSpace: nowrap`, `flex: 1`, `minWidth: 0`

Right side (inline-flex, gap 0.75rem, flexShrink 0):
- StatusBadge: reuse existing component (8px dot + 0.813rem label)
- Task count chip: `fontSize: 0.75rem`, `color: #6b7280`, `fontWeight: 500`
  - Format: `"3 tasks"` or `"1 task"` or `"No tasks"`
  - When tasks include active ones, prefix with a green 6px dot

#### Detail Row (second line)

```
display: flex
justifyContent: space-between
alignItems: center
```

Left side:
- Repo path: `fontSize: 0.813rem`, `color: #6b7280`, `fontFamily: monospace`, `overflow: hidden`, `textOverflow: ellipsis`, `whiteSpace: nowrap`

Right side:
- Expand chevron: `fontSize: 0.75rem`, `color: #9ca3af`, `transition: transform 0.15s ease`
  - Collapsed: points right (Unicode `›` or CSS rotateZ(0))
  - Expanded: points down (rotateZ(90deg))

### 3.2 LocalSiteCard (Expanded State)

Clicking a collapsed card expands it in-place. Only one card can be expanded at a time (accordion pattern).

```
+------------------------------------------------------------------+
| [project-name]                         [*] Running    [v] 3 tasks|
| /path/to/repo                                        [v]        |
|------------------------------------------------------------------|
| URLs: HTTPS  HTTP                                                |
|------------------------------------------------------------------|
| [DriftBanner -- if drift signal exists for any task in this site]|
|------------------------------------------------------------------|
| Tasks                                                            |
|  +--------------------------------------------------------------+|
|  | [mission-label]            [*] Active    2 min ago            ||
|  | joyus/2026-05-04-feat-x    [Resume] [Open in GitHub Desktop] ||
|  +--------------------------------------------------------------+|
|  +--------------------------------------------------------------+|
|  | [mission-label]            [*] Inactive  3 hours ago          ||
|  | joyus/2026-05-03-fix-y     [Resume] [Remove]                 ||
|  +--------------------------------------------------------------+|
|------------------------------------------------------------------|
| Error: Something went wrong (if status === "error")              |
|------------------------------------------------------------------|
| [Start] [Stop] [Restart] [Open] [Remove]                        |
+------------------------------------------------------------------+
```

#### Container (expanded)
```
border: 1px solid #d1d5db  (darker than collapsed)
borderRadius: 8px
padding: 1rem
background: #fff
display: flex
flexDirection: column
gap: 0.75rem
```

#### URL Row

Same as current LocalSiteCard lines 183-206. Only shown when at least one URL exists.

```
display: flex
gap: 0.75rem
fontSize: 0.813rem
```

Links: `color: #1a73e8`, `textDecoration: none`.

#### Drift Banner (scoped to site)

If any `TaskBranch` associated with this site (matched by `repoPath`) has an active drift signal, render a `DriftBanner` inside the expanded card. This scopes drift visibility to the relevant site context rather than showing it at page level.

Use the existing `DriftBanner` component unchanged. It appears between the URL row and the task list.

DriftBanner callbacks: `onDismiss` removes the signal from the drift signals map in `Sites` page state (no re-fetch needed). `onNewSession` ("Start Fresh Task") navigates to `/` (Dashboard), matching Sessions page behavior.

Rationale for card-scoped placement: The Sessions page shows drift banners at page level because every task is a peer. In the Site Manager, tasks are nested under sites, so a page-level drift banner would force the user to mentally map which site it belongs to. Placing the banner inside the expanded card makes the association immediate and avoids clutter when multiple sites have drift signals simultaneously.

#### Task Section Header

```
fontSize: 0.813rem
fontWeight: 600
color: #6b7280
textTransform: uppercase
letterSpacing: 0.05em
marginBottom: 0.25rem
```

This matches the `SectionHeading` pattern from Dashboard but at reduced scale (0.813rem vs 0.875rem) since it is nested inside a card.

#### BranchRow (compact variant)

A condensed version of TaskBranchCard, designed for embedding inside LocalSiteCard. It shows the essential task information without duplicating the full card chrome.

Container:
```
background: #f9fafb
border: 1px solid #f3f4f6
borderRadius: 6px
padding: 0.625rem 0.75rem
display: flex
flexDirection: column
gap: 0.375rem
```

**Row 1: Mission + Status + Timestamp**
```
display: flex
alignItems: center
justifyContent: space-between
gap: 0.5rem
```

Left:
- Mission label: `fontWeight: 500`, `fontSize: 0.8125rem`, `color: #111827`, `overflow: hidden`, `textOverflow: ellipsis`, `whiteSpace: nowrap`, `flex: 1`, `minWidth: 0`

Right (inline-flex, gap 0.625rem, flexShrink 0):
- Status badge: 6px dot (not 8px -- smaller for compact) + 0.75rem label
  - Colors: same STATUS_COLORS from TaskBranchCard (`active: #22c55e`, `stale: #f59e0b`, `broken: #ef4444`, `merged: #6b7280`)
  - Labels: same STATUS_LABELS (`Active`, `Inactive`, `Unavailable`, `Completed`)
- Relative timestamp: `fontSize: 0.75rem`, `color: #9ca3af`
  - Uses `formatRelativeTime` from TaskBranchCard

**Row 2: Branch Name + Actions**
```
display: flex
alignItems: center
justifyContent: space-between
gap: 0.5rem
```

Left:
- Branch name: `fontSize: 0.75rem`, `color: #9ca3af`, `fontFamily: monospace`

Right (inline-flex, gap 0.375rem):
- Compact action buttons. These are smaller than ActionButton and match the TaskBranchCard button pattern:

```
background: transparent | #1a73e8 (for primary)
color: #374151 | #fff (for primary) | #ef4444 (for destructive)
border: 1px solid #d1d5db | none (for primary) | 1px solid #fca5a5 (for destructive)
borderRadius: 4px
padding: 0.1875rem 0.5rem
fontSize: 0.75rem
cursor: pointer
```

Available actions per status:
- `active` / `stale`: Resume (primary), Open in GitHub Desktop (secondary), Remove (destructive)
- `broken`: Remove (destructive)
- `merged`: Remove (destructive)

**Empty state** (no tasks for this site):
```
padding: 0.75rem
textAlign: center
fontSize: 0.813rem
color: #9ca3af
```
Text: `"No active tasks for this site."`

**Sort order**: Task branches sorted by `lastActivityAt` descending (most recent first), matching the SQL query default from `session.listByRepo`.

**Max-height**: If a site has more than 10 task branches, show the first 10 with a "Show N more" link below. This prevents unbounded card growth.

**Loading skeleton** (while task branches load on expand): Single row, height 40px, background `#f9fafb`, border `1px solid #f3f4f6`, border-radius `6px`, `animation: pulse 1.5s ease-in-out infinite`.

**Error state** (task branch loading failure): Red error box inside expanded card:
```
background: #fef2f2
border: 1px solid #fca5a5
borderRadius: 4px
padding: 0.375rem 0.625rem
fontSize: 0.813rem
color: #991b1b
```
Text: `"Could not load tasks for this site."`

#### Error Message

Same as current LocalSiteCard (lines 209-222):
```
background: #fef2f2
border: 1px solid #fca5a5
borderRadius: 4px
padding: 0.375rem 0.625rem
fontSize: 0.813rem
color: #991b1b
```

#### Action Buttons Row

Same as current LocalSiteCard action buttons (lines 225-259). Reuse `ActionButton` component unchanged. Buttons: Start, Stop, Restart, Open, Remove.

### 3.3 ProvisionForm

The existing `ProvisionForm` component is reused without visual changes. It remains always visible in its current position between the health bar and the Local Sites section. No collapsible wrapper is added.

### 3.4 RemoteEnvironmentCard

The existing `RemoteEnvironmentCard` component is reused without changes. Remote environments do not participate in the expand/collapse pattern since they have no associated task branches to show.

### 3.5 Section Component

The existing `Section` component from Sites.tsx is reused for both "Local Sites" and "Remote Environments" sections. It already handles loading, error, empty, and populated states with skeleton cards.

### 3.6 SkeletonCard

Reused unchanged from Sites.tsx. Shown during initial data loading.

---

## 4. Interaction Patterns

### 4.1 Expand/Collapse (Accordion)

**Trigger**: Click the chevron toggle button to expand/collapse. The card container itself is not interactive.

**Behavior**: Only one LocalSiteCard can be expanded at a time. Expanding a card collapses the previously expanded one. This is the standard accordion pattern.

**State management**: `const [expandedSiteId, setExpandedSiteId] = useState<string | undefined>(undefined)`

Clicking an already-expanded card collapses it (toggle behavior).

**Transition**: No CSS animation on expand/collapse. The content appears/disappears immediately. This matches the existing app pattern where no accordion animations are used. If the expanded content is below the fold, scroll the card into view using `scrollIntoView({ behavior: "smooth", block: "nearest" })`.

### 4.2 Data Loading Sequence

Loading is a two-phase process:

1. **Phase 1 (parallel)**: Fetch `site_list_local` and `site_list_remote` simultaneously (same as current). Show skeleton cards in both sections while loading.

2. **Phase 2 (on-demand)**: When a LocalSiteCard is expanded, fetch `session_list` filtered by `repoPath`. Show a compact inline skeleton (single row, 40px height, pulse animation) while loading task branches.

Task branches are cached after first fetch. Re-expanding the same card uses the cached data. A manual refresh button (circular arrow icon) in the task section header allows forcing a reload.

### 4.3 Real-time Updates

**Drift signals**: Subscribe to `state.driftSignal` Tauri events. When an event arrives, match its `taskBranchId` to a task branch, then to a site via `repoPath`. If the matching site is expanded, render the `DriftBanner` inside it.

**Site status changes**: Re-poll `site_list_local` every 30 seconds while the Sites page is mounted, matching the Dashboard polling pattern. This captures status changes from DDEV operations happening outside the app. Use the same pattern as `useUsageSummary` on the Dashboard page (setInterval inside useEffect).

**File modification activity**: Derived from `TaskBranch.lastActivityAt` via 30s polling of `session.countsByRepo`, not real-time events. No `state.fileModification` subscription is needed.

### 4.4 Site Actions

All site-level actions (Start, Stop, Restart, Open, Remove) work identically to the current implementation. They use `safeInvoke` with `site_{action}` commands.

**Remove confirmation**: Uses `window.confirm()` (same as current LocalSiteCard). If the site has active task branches, the confirm message should warn: `Remove "{projectName}"? This site has {N} active task(s) that will also be removed. This cannot be undone.`

### 4.5 Task Branch Actions (within expanded card)

Task actions within the expanded LocalSiteCard mirror the Sessions page behavior:

- **Resume**: `safeInvoke("session_resume", { taskBranchId: id })`
- **Remove**: Two-step confirmation inline (same as TaskBranchCard pendingDelete pattern)
  - If uncommitted changes exist, show the warning modal (same as Sessions page, with `rgba(0,0,0,0.4)` backdrop, 10px border-radius dialog, 420px max-width)
- **Open in GitHub Desktop**: `safeInvoke("open_url", { url: buildGitHubDesktopUrl(repoPath) })`

### 4.6 Provision Flow

Unchanged from current implementation. On successful provision, `loadLocalSites` is called to refresh the list, and the newly provisioned site appears at the bottom of the local sites section.

### 4.7 Keyboard Accessibility

- Cards are NOT focusable — the chevron button handles all keyboard interaction
- Chevron trigger: `<button aria-expanded="true|false" aria-controls="site-detail-{siteId}">` — Enter/Space operates on the chevron button natively (it is a `<button>`)
- Expanded panel: `<div id="site-detail-{siteId}" role="region" aria-labelledby="site-name-{siteId}">`
- Site name: `<span id="site-name-{siteId}">`
- Escape on an expanded panel collapses it and returns focus to the chevron
- Tab moves focus between the chevron button and interactive elements within expanded cards
- Reference: WAI-ARIA Disclosure (Show/Hide) pattern

---

## 5. Visual Consistency Audit

### Color Palette (closed set, no new colors)

All colors used in this design are drawn from existing components:

| Token | Hex | Source |
|-------|-----|--------|
| Text primary | `#111827` | Layout, all cards |
| Text secondary | `#374151` | StatusBadge, buttons |
| Text muted | `#6b7280` | Repo paths, timestamps, Section headers |
| Text disabled | `#9ca3af` | Chevrons, empty states, relative times |
| Background page | `#f9fafb` | Layout, BranchRow bg |
| Background card | `#fff` | All cards |
| Background disabled | `#f3f4f6` | ActionButton disabled, section dividers |
| Border default | `#e5e7eb` | All card borders |
| Border hover | `#d1d5db` | Card hover, button borders |
| Border section | `#f3f4f6` | BranchRow border |
| Primary blue | `#1a73e8` | Links, primary buttons, nav active |
| Status running | `#22c55e` | StatusBadge, STATUS_COLORS |
| Status stopped | `#94a3b8` | StatusBadge (canonical source for stopped status) |
| Status starting | `#f59e0b` | StatusBadge, STATUS_COLORS |
| Status error | `#ef4444` | StatusBadge, STATUS_COLORS, destructive buttons |
| Error bg | `#fef2f2` | Error messages |
| Error border | `#fca5a5` | Error messages, destructive button borders |
| Error text | `#991b1b` | Error messages |
| Drift low bg | `#fffbeb` | DriftBanner |
| Drift low border | `#fde68a` | DriftBanner |
| Drift low text | `#92400e` | DriftBanner |
| Drift high bg | `#fff7ed` | DriftBanner |
| Drift high border | `#fed7aa` | DriftBanner |
| Drift high text | `#7c2d12` | DriftBanner |
| Drift high action | `#ea580c` | DriftBanner button |

### Typography Scale (closed set)

| Size | Weight | Usage |
|------|--------|-------|
| `1.5rem` | 700 | Page title (h1) |
| `1.125rem` | 600 | Section headers (h2) |
| `0.9375rem` | 600 | Card primary name |
| `0.875rem` | 400-600 | Body text, section headings, buttons |
| `0.813rem` / `0.8125rem` | 400-600 | Secondary text, status labels, links, small buttons |
| `0.75rem` | 400-500 | Timestamps, compact badges, chevrons |

Font stack: `system-ui, -apple-system, sans-serif` (from Layout).
Monospace: browser default `monospace` (for repo paths, branch names).

### Border Radius Scale

| Value | Usage |
|-------|-------|
| `4px` | ActionButton, error messages, compact action buttons |
| `6px` | BranchRow, DriftBanner, modal buttons |
| `8px` | LocalSiteCard, RemoteEnvironmentCard, Section empty state, error banners |
| `10px` | Delete confirmation modal |
| `50%` | Status dots |
| `9999px` | Type badge pill (RemoteEnvironmentCard) |

### Component Reuse Map

| Existing Component | Reused As-Is | Notes |
|-------------------|--------------|-------|
| `Section` | Yes | Wraps both Local Sites and Remote Environments |
| `SkeletonCard` | Yes | Loading states |
| `StatusBadge` | Yes | Site status in collapsed card |
| `ActionButton` | Yes | Site-level actions in expanded card |
| `DriftBanner` | Yes | Scoped to expanded LocalSiteCard instead of page-level |
| `RemoteEnvironmentCard` | Yes | No changes |
| `LocalSiteCard` | Extended | Extended with expand/collapse, branch count badge, and activity indicator. Existing props and behavior preserved. |
| `ProvisionForm` | Yes | Reused as-is, always visible, no collapsible wrapper |

### New Components

| Component | Justification |
|-----------|--------------|
| `BranchRow` | Compact variant of task display for embedding. Full `TaskBranchCard` is too large for nesting inside another card. |
| `AggregateHealthBar` | New summary widget. Simple enough (flex row of dots + counts) to not warrant a separate file -- inline in `Sites.tsx`. |

Note: `LocalSiteCard` gains new props per plan WP-11: `expanded`, `onToggleExpand`, `branchCounts`, and `lastBranchActivity`. It is extended in place, not replaced.

### Animation Keyframes

Two keyframe animations are used. Both must be defined globally in `apps/desktop-companion/src/ui/global.css` (imported in `main.tsx`). Currently `@keyframes spin` exists only in `Onboarding.tsx` (scoped) and `@keyframes pulse` is undefined globally — both are silently broken on other pages. A global CSS file must be added as part of this work (WP-4):

```css
@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
```

---

## 6. Wireframes

### 6.1 Page -- Loading State

```
+------------------------------------------------------------------+
| Sites                                                             |
|                                                                   |
| Local Sites                                                       |
| +--------------------------------------------------------------+ |
| |  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  (skeleton, pulse anim)  | |
| +--------------------------------------------------------------+ |
| +--------------------------------------------------------------+ |
| |  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░                           | |
| +--------------------------------------------------------------+ |
|                                                                   |
| Remote Environments                                               |
| +--------------------------------------------------------------+ |
| |  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░                           | |
| +--------------------------------------------------------------+ |
| +--------------------------------------------------------------+ |
| |  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░                           | |
| +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
```

### 6.2 Page -- Loaded, All Collapsed

```
+------------------------------------------------------------------+
| Sites                                                             |
| 5 sites                                                          |
|                                                                   |
| * 2 Running   * 1 Starting   * 1 Stopped   * 1 Error            |
|                                                                   |
| [https://github.com/org/repo.git          ] [Provision]          |
|                                                                   |
| Local Sites (3)                                                   |
| +--------------------------------------------------------------+ |
| | my-project                    [*] Running          2 tasks  > | |
| | /Users/dev/projects/my-project                                | |
| +--------------------------------------------------------------+ |
| +--------------------------------------------------------------+ |
| | another-site                  [*] Starting         1 task   > | |
| | /Users/dev/projects/another-site                              | |
| +--------------------------------------------------------------+ |
| +--------------------------------------------------------------+ |
| | broken-site                   [*] Error            No tasks > | |
| | /Users/dev/projects/broken-site                               | |
| +--------------------------------------------------------------+ |
|                                                                   |
| Remote Environments (2)                                           |
| +--------------------------------------------------------------+ |
| | org/repo           [Probo]          [*] active                | |
| | PR #42: Fix layout issue            Open Environment          | |
| | Last checked: 5/4/2026, 2:30:00 PM                           | |
| +--------------------------------------------------------------+ |
| +--------------------------------------------------------------+ |
| | org/repo2          [Joyus AI]       [*] building              | |
| | PR #18: Add feature                 Open Environment          | |
| | Last checked: 5/4/2026, 2:28:00 PM                           | |
| +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
```

### 6.3 LocalSiteCard -- Expanded with Tasks

```
+------------------------------------------------------------------+
| my-project                      [*] Running          2 tasks  v  |
| /Users/dev/projects/my-project                                   |
|------------------------------------------------------------------|
| URLs: HTTPS  HTTP                                                |
|------------------------------------------------------------------|
| +--------------------------------------------------------------+ |
| | Your work may be spreading across multiple areas. Consider   | |
| | starting a fresh task.                                   [x] | |
| +--------------------------------------------------------------+ |
|------------------------------------------------------------------|
| TASKS                                                     [O]   |
| +--------------------------------------------------------------+ |
| | Implement user login flow     [*] Active        2 min ago    | |
| | joyus/2026-05-04-login   [Resume] [Open in GitHub Desktop]  | |
| +--------------------------------------------------------------+ |
| +--------------------------------------------------------------+ |
| | Fix header alignment          [*] Inactive      3 hours ago  | |
| | joyus/2026-05-03-header       [Resume] [Remove]              | |
| +--------------------------------------------------------------+ |
|------------------------------------------------------------------|
|                                                                  |
| [Start] [Stop] [Restart] [Open] [Remove]                        |
+------------------------------------------------------------------+
```

`[O]` = refresh button for task list
`[x]` = dismiss drift banner

### 6.4 LocalSiteCard -- Expanded, No Tasks

```
+------------------------------------------------------------------+
| my-project                      [*] Running      No tasks     v  |
| /Users/dev/projects/my-project                                   |
|------------------------------------------------------------------|
| URLs: HTTPS  HTTP                                                |
|------------------------------------------------------------------|
| TASKS                                                            |
| +--------------------------------------------------------------+ |
| |              No active tasks for this site.                  | |
| +--------------------------------------------------------------+ |
|------------------------------------------------------------------|
|                                                                  |
| [Start] [Stop] [Restart] [Open] [Remove]                        |
+------------------------------------------------------------------+
```

### 6.5 LocalSiteCard -- Expanded, Error State

```
+------------------------------------------------------------------+
| broken-site                     [*] Error        No tasks     v  |
| /Users/dev/projects/broken-site                                  |
|------------------------------------------------------------------|
| +--------------------------------------------------------------+ |
| | DDEV failed to start: port 443 already in use               | |
| +--------------------------------------------------------------+ |
|------------------------------------------------------------------|
| TASKS                                                            |
| +--------------------------------------------------------------+ |
| |              No active tasks for this site.                  | |
| +--------------------------------------------------------------+ |
|------------------------------------------------------------------|
|                                                                  |
| [Start] [Stop] [Restart] [Open] [Remove]                        |
+------------------------------------------------------------------+
```

### 6.6 Provision Form

```
+------------------------------------------------------------------+
| [https://github.com/org/repo.git          ] [Provision]         |
+------------------------------------------------------------------+
```

### 6.7 Delete Task -- Uncommitted Changes Modal

```
+------------------------------------------------------------------+
|                                                                  |
|   +----------------------------------------------------------+   |
|   |                                                          |   |
|   |  This task has unsaved changes                           |   |
|   |                                                          |   |
|   |  Removing this task will discard changes that haven't    |   |
|   |  been saved. This cannot be undone.                      |   |
|   |                                                          |   |
|   |                          [Keep It] [Remove Anyway]       |   |
|   |                                                          |   |
|   +----------------------------------------------------------+   |
|                                                                  |
+------------------------------------------------------------------+
```

Modal: same as Sessions page (rgba(0,0,0,0.4) backdrop, #fff bg, 10px border-radius, 420px max-width, 1.5rem padding, 0 20px 40px rgba(0,0,0,0.15) box-shadow).

---

## 7. Responsive Behavior

The layout is designed for a minimum content width of 600px. There are no breakpoints or media queries -- the app enforces 800px minimum window width via Layout.

- Action button rows use `flexWrap: wrap` so buttons wrap to a second line at narrow widths
- Task branch rows use `flexWrap: wrap` on the action area
- The Aggregate Health Bar uses `flexWrap: wrap`
- Remote environment cards handle long repo names with `overflow: hidden` / `textOverflow: ellipsis`

---

## 8. Data Flow Summary

### Join Strategy

Sites and TaskBranches are joined by `repoPath`:

```
LocalSite.repoPath === TaskBranch.repoPath
```

This is the same index used by `taskBranchStore.ts` (SQLite index on `repo_path`). The join happens client-side after both data sets are loaded.

### IPC Commands Used

| Command | Params | Returns | When |
|---------|--------|---------|------|
| `site_list_local` | none | `LocalSite[]` | Page mount, 30s polling |
| `site_list_remote` | none | `RemoteEnvironment[]` | Page mount |
| `site_start` | `{ siteId }` | void | Start button |
| `site_stop` | `{ siteId }` | void | Stop button |
| `site_restart` | `{ siteId }` | void | Restart button |
| `site_remove` | `{ siteId }` | void | Remove button |
| `site_provision` | `{ repoUrl }` | void | Provision form |
| `session_list` | none | `TaskBranch[]` | Card expand |
| `session_resume` | `{ taskBranchId }` | void | Resume button |
| `session_delete` | `{ taskBranchId, force }` | void | Remove task |
| `session_has_uncommitted_changes` | `{ taskBranchId }` | `{ hasUncommittedChanges }` | Before delete |
| `open_url` | `{ url }` | void | Open in GitHub Desktop |

### Event Subscriptions

| Event | Payload | Handler |
|-------|---------|---------|
| `state.driftSignal` | `{ taskBranchId, confidence, heuristics, explanation }` | Show DriftBanner in matching expanded LocalSiteCard |

---

## 9. State Management

All state is local to the `Sites` page component using `useState` / `useEffect` hooks. No global state store or context providers are introduced.

### State Variables

The page component tracks the following state, all local via `useState` / `useEffect`:

**Data state:**
- List of local sites (`LocalSite[]`) -- fetched on mount and polled every 30 seconds
- List of remote environments (`RemoteEnvironment[]`) -- fetched on mount
- List of task branches (`TaskBranch[]`) -- fetched on first card expand, cached thereafter

**Loading state:**
- Local sites loading flag (initially true)
- Remote environments loading flag (initially true)
- Task branches loading flag (initially false, set true during fetch)

**Error state:**
- Local sites error message (string or undefined)
- Remote environments error message (string or undefined)

**Interaction state:**
- Currently expanded site ID (string or undefined) -- at most one card expanded. When `localSites` is updated (from polling or after a remove action), if `expandedSiteId` does not match any site in the updated list, reset it to `undefined`.

**Real-time state:**
- Active drift signals map (`Map<string, DriftSignalPayload>`) keyed by `taskBranchId` (same shape as Sessions page). `onDismissDrift` removes a signal from this map; "Start Fresh Task" navigates to `/` (Dashboard).

**Task deletion state (same pattern as Sessions page):**
- Pending delete task branch ID (string or undefined)
- Pending delete has-uncommitted-changes flag (boolean)

### Derived Values

The following values are computed from the state above, not stored separately:

- **Tasks for expanded site**: Filter the task branches list to those whose `repoPath` matches the `repoPath` of the currently expanded site.
- **Aggregate status counts**: Count local sites by status (running, stopped, starting, error) for the health bar. Statuses with zero count are omitted from display.
- **Task count per site**: For each local site, count matching task branches by `repoPath`. Used in collapsed card display ("2 tasks", "No tasks").

---

## 10. Open Questions

1. **Task branch fetch strategy**: Should task branches be fetched once on page mount (simpler, one IPC call) or lazily on card expand (fewer initial data, but delays expand)? This spec recommends lazy fetch with caching, but the implementer may choose eager fetch if the expected task count is small (under 50).

2. **Remote environment task association**: Remote environments currently have a `taskBranchId` field. Should the expanded view for remote environments also show associated task details? This spec defers that to a follow-up, keeping remote cards unchanged for now.
