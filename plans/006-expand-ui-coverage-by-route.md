# Plan 006: Expand UI Coverage By Route

## Summary

Plan 003 restored TSX typechecking and added a narrow UI coverage seed. It did not honestly restore full UI coverage because a broad TSX coverage probe pulled in dozens of uncovered UI files and dropped overall coverage to about 67.5%. This plan stages the remaining UI coverage work by route and shared component, so the repo can move from "UI is visible to coverage" to "UI behavior is protected by coverage" without turning the test suite into shallow coverage theater.

Execution note from 2026-06-13: the first route slice covered `apps/desktop-companion/src/ui/pages/Servers.tsx` with behavior tests for loading, empty, Chrome unavailable, error, and populated-list states. The second route slice split the Skills route into a thin Tauri/hook container and covered `apps/desktop-companion/src/ui/pages/SkillsView.tsx` plus `apps/desktop-companion/src/ui/components/SkillList.tsx`.

Completion note from 2026-06-13: the remaining route groups now have behavior-focused coverage: governance, sessions/sites, recon, onboarding/settings/usage, and direct hooks. Coverage now includes UI pages, hooks, and shared components without reintroducing a broad UI exclusion, and `pnpm run ci` passes the typecheck, coverage, and integration-test gates. This completes the Plan 006 UI coverage scope only. It does not resolve Plan 001's sync IPC adapter STOP condition or the separate desktop build/signing hardening work.

## Priority

- Priority: P1
- Risk: Medium
- Effort: Large
- Dependencies: Plan 003 must land first.

## What This Is Not Claiming

- This plan is not claiming every page needs brittle DOM snapshots.
- This plan is not claiming the current UI is broken.
- This plan is not claiming coverage should be broadened before useful tests exist.
- This plan is claiming the current seed coverage is deliberately incomplete and should not be mistaken for full UI confidence.

## Evidence

- Root coverage can include UI rows after Plan 003, but only for a narrow tested slice.
- A broad probe using TSX UI coverage showed low rows across `apps/desktop-companion/src/ui/pages`, `apps/desktop-companion/src/ui/hooks`, and several components.
- Existing UI tests use React server rendering via `renderToStaticMarkup`, for example `apps/desktop-companion/test/ui/App.test.ts` and component tests under `apps/desktop-companion/test/ui/components`.
- The UI invokes Tauri through hook/component boundaries such as `apps/desktop-companion/src/ui/hooks/useServerStatus.ts`, `apps/desktop-companion/src/ui/hooks/useSyncStatus.ts`, `apps/desktop-companion/src/ui/hooks/useGovernance.ts`, and direct `safeInvoke` helpers in several pages/components.

## Implementation Steps

1. Pick one route group at a time.
   - Suggested order: servers, skills/sync, governance, sessions/sites, recon, onboarding/settings/usage.
   - Keep each commit focused on one route group plus the shared components it needs.

2. Add useful behavior tests.
   - Prefer user-observable behavior: loading, empty, error, populated, and action-trigger states.
   - Mock `@tauri-apps/api/core` at the command boundary.
   - Avoid tests that only assert that a component rendered any text unless that text represents a real state transition or route contract.

3. Broaden coverage only after tests exist.
   - Add the newly covered files to `vitest.config.ts`.
   - Once most route groups are covered, replace the narrow TSX include list with `apps/desktop-companion/src/ui/**/*.tsx`.
   - Remove temporary narrow exclusions only when `pnpm coverage` remains at 100%.

4. Keep hooks separate from pages.
   - Hooks such as `useServerStatus`, `useSyncStatus`, `useGovernance`, `useRecon`, and `useTauriEvent` should get direct tests or a shared harness.
   - If a hook requires a browser-like environment, add the smallest supported Vitest environment/config change and document it in the test file.

5. Watch for design pressure.
   - If a page cannot be tested without excessive mocking, extract small pure view components or adapters.
   - Do not refactor page architecture just to satisfy a coverage row unless the extracted boundary also makes behavior clearer.

## STOP Conditions

Stop and split further if:

- One route group requires more than five substantial tests.
- A browser DOM environment is required and conflicts with the current Node-based Vitest suite.
- Tauri runtime mocking becomes global and brittle.
- Coverage can only be achieved with snapshots or assertions that would not catch plausible regressions.

## Acceptance Criteria

- `pnpm coverage` includes route/page UI rows beyond the Plan 003 seed.
- Each newly included UI file has behavior-focused tests.
- `pnpm coverage` still enforces 100% lines, functions, branches, and statements.
- No broad `apps/**/src/ui/**` coverage exclusion is reintroduced.
- The implementation summary records which UI route group was added.

## Verification

```bash
pnpm typecheck
pnpm test
pnpm coverage
pnpm coverage 2>&1 | rg "apps/desktop-companion/src/ui|src/ui"
pnpm run ci
```

The final `rg` should show the newly included route/page rows, not only `utils` and the Plan 003 seed components.

## Adversarial Self-Check

The weak version of this plan is coverage theater: rendering every page once and calling it protected. A skeptic should be able to point to each new test and name the user-facing regression it would catch.
