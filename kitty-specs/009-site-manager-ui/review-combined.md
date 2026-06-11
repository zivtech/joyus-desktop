# Combined Review Summary: Site Manager Panel

## Overall Verdict: REVISE

The worst verdict from any critic determines the overall verdict. Both the UI critic and proposal critic returned REVISE; the dashboard critic returned ACCEPT-WITH-RESERVATIONS.

The plan architecture is sound -- incremental migration, justified component decomposition, clear dependency graph, thoughtful architecture decisions. The design spec is thorough and internally consistent. But the two documents contradict each other on at least six material points and must be reconciled before implementation begins.

---

## Cross-Cutting Findings

These issues appeared across multiple critics:

| Finding | Dashboard | UI | Proposal |
|---------|-----------|-----|----------|
| `state.fileModification` event doesn't exist (plan rejects it, design depends on it) | -- | C1 | C1 |
| `LocalSiteCard` modify vs. replace contradiction | -- | -- | C2 |
| Missing Rust Tauri command wrappers for new IPC methods | M2 | -- | M2 |
| `TaskBranch` interface missing PR fields, wrong WP cited | M1 | -- | M6 |
| No join key between RemoteEnvironment and LocalSite | M3 | -- | -- |
| KPI Bar: StatCards (plan) vs. dot-count row (design) | -- | -- | M1 |
| Expand trigger: chevron-only (plan) vs. click-anywhere (design) | -- | M1 | M3 |
| Polling cadence: 30s (plan) vs. 15s (design) | -- | -- | M4 |
| ProvisionForm: always-visible (plan) vs. collapsible (design) | -- | -- | M5 |
| No ARIA semantics for accordion pattern | -- | M2 | -- |
| `expandedSiteId` not cleaned up on site removal | -- | M3 | -- |
| `@keyframes pulse` doesn't exist (false claim) | -- | C2 | -- |
| Drift signal event name mapping may be broken | m4 | -- | M7 |
| DriftBanner callback props unaccounted for | m2 | -- | -- |
| No frontend component test plan (100% coverage required) | -- | -- | m5 |

---

## Per-Critic Verdicts

| Critic | Verdict | Critical | Major | Minor |
|--------|---------|----------|-------|-------|
| Dashboard Critic | ACCEPT-WITH-RESERVATIONS | 0 | 3 | 5 |
| UI Critic | REVISE | 2 | 3 | 8 |
| Proposal Critic | REVISE | 2 | 7 | 6 |

---

## Required Fixes Before Implementation

### Must resolve (blocks execution):

1. **Reconcile `state.fileModification`**: Plan says don't create it (AD-7). Design depends on it. Choose: create the event in sidecar, or drop the File Activity Pulse feature.

2. **Reconcile `LocalSiteCard` strategy**: Plan says modify (WP-11, AD-4). Design says replace. Pick one.

3. **Define `@keyframes pulse` globally**: It doesn't exist anywhere. Both existing skeleton cards and the proposed pulse indicator reference it silently. Add to a global stylesheet.

4. **Add Rust Tauri command wrappers**: WP-3 must include `commands.rs` and `main.rs` changes, not just sidecar registration.

### Must reconcile (documents disagree):

5. **KPI Bar widget**: StatCards vs. dot-count health bar. Pick one or document both with clear placement.

6. **Expand trigger**: Chevron-only vs. click-anywhere. Pick one and specify click propagation strategy.

7. **Polling cadence**: Standardize on 30s (matching Dashboard) or justify 15s for site status.

8. **ProvisionForm**: Always-visible or collapsible? If collapsible, add a WP.

### Must add (gaps):

9. **WP-4b**: Sync frontend `TaskBranch` interface (add `prNumber/prUrl/prTitle`). Currently buried in Risk Register pointing to wrong WP.

10. **Join key for RemoteEnvironment-to-LocalSite**: Specify how `repoOwner/repoName` maps to `repoPath/repoUrl`.

11. **ARIA semantics**: Add `role="button"`, `aria-expanded`, `aria-controls` to accordion trigger. `role="region"`, `aria-labelledby` to expanded panel.

12. **`expandedSiteId` cleanup**: Reset when the expanded site disappears from the list.

13. **DriftBanner callbacks**: Thread `onDismiss` and `onNewSession` through `SiteCardExpanded`, with Sites-context-appropriate behavior.

14. **Frontend component tests**: Plan covers store method tests only. 6 new React components need test coverage for 100% enforcement.

---

## Companion Planners for Fix-Planning

- `/dashboard-planner` -- reconcile KPI bar, polling, and data architecture decisions
- `/design-partner` -- reconcile visual/interaction design contradictions
