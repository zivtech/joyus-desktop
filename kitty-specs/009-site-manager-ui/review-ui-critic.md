# UI Critic Review: Site Manager Panel Design Spec

**Verdict: REVISE**

---

## Critical Findings

### C1. `state.fileModification` Tauri event does not exist

Section 4.3 subscribes to `state.fileModification` events and Section 8 lists the payload shape. But no `sendNotification("state.fileModification", ...)` call exists anywhere in the codebase. The `FileModificationDetector` emits events internally via callbacks, wired only to the `driftDetector` in `sessionWiring.ts`. The File Activity Pulse feature (Section 3.1) is unimplementable as specified.

**Fix**: Either (a) extend `sessionWiring.ts` to emit the notification to the Tauri event bus, or (b) remove the pulse feature from this spec.

### C2. `@keyframes pulse` does not exist in the codebase

Section 5 claims "No new keyframe animations are introduced" and "both already exist in the codebase." Only `@keyframes spin` exists, scoped to `Onboarding.tsx:437`. The `@keyframes pulse` referenced by `SkeletonCard` (Sites.tsx:153, Servers.tsx:43) and the proposed File Activity Pulse is undefined -- meaning existing skeleton cards are already silently broken (static gray boxes, no animation).

**Fix**: Define `@keyframes pulse` in a global stylesheet or `App.tsx` injection. Remove the false claim that both keyframes already exist. Also note that `@keyframes spin` is scoped to the Onboarding page and unavailable elsewhere.

## Major Findings

### M1. No click propagation strategy for accordion

Section 4.1 says "Click anywhere on the collapsed SiteCard, except on action buttons or links." But no `stopPropagation()` or delegation strategy is specified. The expanded card houses ActionButtons, TaskBranchRow buttons, URL links, and DriftBanner buttons -- all nested inside the click target. The codebase has zero existing uses of `stopPropagation`.

**Fix**: Specify that the card-level `onClick` goes only on the header rows (name + status + detail row), not the entire container. OR specify that all interactive children must call `e.stopPropagation()`.

### M2. No ARIA semantics for accordion

Section 4.7 specifies `tabIndex: 0` and Enter/Space toggling but omits `role="button"`, `aria-expanded`, `aria-controls`, and `id` linking. A `<div tabIndex={0}>` without a role is announced as "group" by screen readers -- users won't know it's interactive or expandable.

**Fix**: Add WAI-ARIA Disclosure pattern: `role="button"`, `aria-expanded="true|false"`, `aria-controls` on trigger. `role="region"`, `aria-labelledby` on the expanded panel.

### M3. `expandedSiteId` not cleaned up on site removal or disappearance

If the user removes the currently expanded site, or the 15s poll returns a list without it, `expandedSiteId` becomes stale. The component will try rendering an expanded view for a non-existent site.

**Fix**: When `localSites` updates, if `expandedSiteId` doesn't match any site, reset to `undefined`.

## Minor Findings

1. **Typography `0.938rem` vs `0.9375rem`** -- same value (15px), different expression. Reconcile to one form.
2. **DriftBanner border-radius**: table says 6px but high-confidence variant uses 8px.
3. **`RemoteEnvironmentCard` stopped color**: falls back to `#6b7280`, not `#94a3b8`.
4. **ProvisionForm heading as h2**: equal visual weight to section headers may be unexpected for a secondary action.
5. **No max height or "show more" for many task branches** -- 20+ branches makes the expanded card unboundedly tall.
6. **No loading indicator style spec** for task branches on expand (Section 4.2 mentions it but Section 3 doesn't specify it).
7. **No error state** for task branch loading failure on expand.
8. **No task branch sort order** specified.
