# Dashboard Critic Review: Site Manager Panel

**Verdict: ACCEPT-WITH-RESERVATIONS**

---

## Critical Findings

None.

## Major Findings

### M1. PR field sync mitigation points to wrong WP

The Risk Register says `TaskBranch` in `TaskBranchCard.tsx` is missing `prNumber/prUrl/prTitle` and the fix "should be done as part of WP-4 (shared utilities phase)." But WP-4 is about extracting `formatRelativeTime`. An executor following WP-4 literally will NOT sync the interface, and WP-7 (BranchRow) will fail to compile.

**Fix**: Add a dedicated WP-4b "Sync frontend `TaskBranch` interface" or explicitly list it as a subtask within WP-7.

### M2. Missing Rust Tauri command layer for new IPC methods

WP-3 only references `apps/desktop-companion/src/sidecar/services.ts` (sidecar JSON-RPC). But the architecture has three layers: React -> Tauri Rust commands (`commands.rs`) -> sidecar. Every existing site command has a Rust wrapper in `commands.rs` registered in `main.rs`. Without corresponding Rust commands, `safeInvoke("session_counts_by_repo")` calls will fail.

Note: Existing `session_list`, `session_resume`, etc. are also absent from `commands.rs` -- this may be a shared WIP gap rather than plan-specific.

**Fix**: Add Rust command wrappers to WP-3 scope, or document the alternative dispatch mechanism.

### M3. No join key between `RemoteEnvironment` and `LocalSite`

The data flow shows `RemoteEnvRow (filtered from remoteSites by matching repo)`. But `RemoteEnvironment` has `repoOwner`/`repoName` while `LocalSite` has `repoPath`/`repoUrl`. No common field exists for joining.

**Fix**: Specify the join strategy: parse `LocalSite.repoUrl` to extract owner/name, add `repoPath` to `RemoteEnvironment`, or add `repoOwner/repoName` to `LocalSite`.

## Minor Findings

1. **`safeListen` duplicated across 6 files.** `useTauriEvent.ts` hook already wraps this pattern -- reuse it rather than adding another copy.

2. **`DriftBanner` requires `onDismiss` and `onNewSession` callbacks** not accounted for in `SiteCardExpanded` props. What should "Start Fresh Task" do in the Sites context?

3. **`StatCard` is file-local in `Dashboard.tsx`**, not exported. `SiteKpiBar` either needs it extracted to shared, or will duplicate the pattern.

4. **Event naming: `state.driftSignal` may not reach the frontend.** `sidecar.rs:map_notification_to_event` doesn't map it explicitly -- it would become `sidecar:state.driftSignal`. Verify the Sessions page actually receives drift events.

5. **No refresh after branch actions.** When a user resumes or deletes a branch in the expanded card, neither the branch list nor the KPI bar refresh is specified.
