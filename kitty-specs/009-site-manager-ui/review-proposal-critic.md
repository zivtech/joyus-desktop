# Proposal Critic Review: Site Manager Panel (Plan + Design Spec)

**Verdict: REVISE**

---

## Critical Findings

### C1. `state.fileModification` event: plan rejects it, design spec depends on it

- Plan AD-7: "A new `state.fileModification` Tauri event is not needed because the 30-second polling refresh of `session.countsByRepo` is sufficient."
- Design spec section 4.3: "Subscribe to `state.fileModification` Tauri events."
- The event doesn't exist in the codebase.

These documents directly contradict each other. The File Activity Pulse feature is unimplementable as designed.

**Fix**: Choose one approach and align both documents.

### C2. `LocalSiteCard` strategy: modify (plan) vs. replace (design)

- Plan WP-11 + AD-4: "Extend `LocalSiteCard` with expand/collapse and badges" / "expanded in place rather than replaced."
- Design spec Section 5: "`LocalSiteCard | Replaced | Replaced by new SiteCard. Not a wrapper -- a replacement.`"

Mutually exclusive strategies producing different file structures, imports, and test approaches.

**Fix**: Pick one. Given the plan's incremental migration philosophy, extending is more consistent.

## Major Findings

### M1. KPI Bar: plan and design describe different widgets

- Plan: `SiteKpiBar` with four `StatCard` instances (total sites, active branches, recent sites, sites with issues).
- Design: `AggregateHealthBar` with colored dots showing status distribution (3 Running, 1 Starting, etc.), inlined in Sites.tsx.

Structurally and visually different components.

**Fix**: Decide which KPI summary is needed. Perhaps both serve different purposes -- make that explicit.

### M2. Rust Tauri command wrappers missing from scope

The plan proposes two new sidecar methods (WP-1 through WP-3) but never mentions the Rust command layer (`commands.rs`, `main.rs`). Every existing site command has a Rust wrapper. Without them, `safeInvoke()` calls fail.

**Fix**: Add Rust commands to WP-3 scope.

### M3. Expand trigger contradicts: chevron (plan) vs. click-anywhere (design)

- Plan: "chevron toggle in the action button row" implies chevron-only.
- Design: "Click anywhere on the collapsed SiteCard, except on action buttons or links."

Different UX patterns with different implementation complexity.

**Fix**: Choose one and specify click propagation strategy.

### M4. Polling cadence contradicts: 30s (plan) vs. 15s (design)

- Plan WP-15: 30-second refresh for `session.countsByRepo`, matching Dashboard pattern.
- Design Section 4.3: 15-second polling for `site_list_local`.

Different refresh rates for different data on the same page creates visual inconsistency.

**Fix**: Standardize on 30s, matching existing Dashboard pattern. Document if 15s is needed and why.

### M5. ProvisionForm: always-visible (plan) vs. collapsible (design)

- Plan: `ProvisionForm` listed as "reused as-is," stays in current position.
- Design: wrapped in a collapsible section defaulting to collapsed, with conditional expand when no sites exist.

The collapsible wrapper doesn't appear in any work package.

**Fix**: Add a WP for the collapsible wrapper, or remove it from the design spec.

### M6. `TaskBranch` interface sync in wrong WP

Plan Risk Register correctly identifies missing `prNumber/prUrl/prTitle` but says fix "should be done as part of WP-4." WP-4 is `formatRelativeTime` extraction -- unrelated.

**Fix**: Add WP-4b or include in WP-7 as prerequisite.

### M7. Tauri event name mapping may break drift signals

`sidecar.rs:map_notification_to_event` doesn't map `state.driftSignal` -- it would become `sidecar:state.driftSignal`. Sessions page listens for `"state.driftSignal"` (no prefix). If drift signals are broken, a core feature is silently non-functional.

**Fix**: Verify Sessions page drift signals work. If not, add mapping in `sidecar.rs`.

## Minor Findings

1. **15 WPs across 5 phases** -- justified by dependency map and parallelism opportunities. Not overengineered.
2. **806-line design spec** -- thorough but not harmful. Prevents implementer ambiguity for inline CSS.
3. **`safeInvoke` duplicated** across 4+ files -- missed extraction opportunity for WP-4.
4. **`STATUS_COLORS.stopped` inconsistency** identified by design spec but not tracked as a WP.
5. **No frontend component test plan** -- project enforces 100% coverage but plan only specifies store method tests.
6. **"Open GitHub" vs "Open in GitHub Desktop"** -- plan says "opens in browser" but code uses `x-github-client://` protocol.

## What's Missing

- No WP for Rust command wrappers
- No test plan for 6 new React components (100% coverage required)
- No stale cache handling when branches change from Sessions page
- No expected data volume estimates to justify new IPC methods vs. client-side filtering
- No join key strategy for RemoteEnvironment-to-LocalSite association
