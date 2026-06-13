# Plan 003: Restore UI Typecheck And Coverage Gates

## Summary

The desktop UI is not fully protected by the root verification gates. Root TypeScript checking excludes TSX, and coverage excludes the whole UI source tree. The project has UI tests, but the main gates do not force the UI surface to stay typed and covered.

Execution note from 2026-06-13: the full TSX coverage expansion tripped this plan's STOP condition. Running coverage with `apps/desktop-companion/src/ui/**/*.tsx` included dropped overall coverage to about 67.5%, with dozens of uncovered UI pages/components/hooks. The first executable slice is therefore root TSX typecheck plus a narrow UI coverage seed for already-tested UI utilities/components. Plan 006 owns the broader route-by-route coverage expansion.

## Priority

- Priority: P1
- Risk: High
- Effort: Large
- Dependencies: Plan 002 should land first.

## What This Is Not Claiming

- This plan is not claiming the UI is currently broken.
- This plan is not claiming every UI file must be tested through brittle DOM snapshots.
- This plan is claiming the current root gates are not measuring a major user-facing surface.

## Evidence

- `package.json:11` defines `typecheck` as `tsc --noEmit`.
- `tsconfig.json:21-22` includes `apps/**/*.ts` and `packages/**/*.ts`, then excludes `**/*.tsx`.
- `apps/desktop-companion/tsconfig.json:1-8` is configured for React JSX and includes app source and tests.
- `vitest.config.ts:12-18` coverage includes only `apps/**/src/**/*.ts` and `packages/**/src/**/*.ts`, and explicitly excludes `apps/**/src/ui/**`.
- The UI source tree is substantial: 39 source files and about 8477 lines under `apps/desktop-companion/src/ui`.
- UI tests already exist under `apps/desktop-companion/test/ui`, including `apps/desktop-companion/test/ui/App.test.ts`.

## Implementation Steps

1. Land Plan 002 first.
   - Do not broaden coverage while test discovery is still duplicating package tests through `node_modules`.

2. Restore TSX typechecking.
   - Prefer using the existing app TypeScript project instead of cramming all JSX concerns into the root config.
   - Add a script such as `typecheck:ui` that runs:

```bash
tsc --noEmit -p apps/desktop-companion/tsconfig.json
```

   - Update the root `typecheck` script to run both the existing root check and the UI check.
   - Alternatively, remove the TSX exclusion from the root config only if JSX settings, test globals, and module resolution remain clean.

3. Restore UI coverage intentionally.
   - Add `apps/**/src/**/*.tsx` to coverage include.
   - Remove the blanket `apps/**/src/ui/**` coverage exclusion.
   - If some UI entrypoints are not testable in Vitest because they require Tauri runtime globals, exclude those narrowly by exact file path and add a short comment explaining why.
   - Do not keep a broad UI-tree exclusion.

4. Add focused UI tests until coverage passes.
   - Prefer behavior tests over snapshots.
   - Cover hooks and components at user-observable boundaries.
   - Mock Tauri IPC at the boundary, not deep inside component internals.
   - Avoid rewriting component architecture just to satisfy coverage unless the current design makes reasonable tests impossible.

5. Keep the blast radius visible.
   - After coverage config changes, inspect the coverage table to confirm UI files are included.
   - If dozens of files enter coverage at once, group test additions by route/page so review stays understandable.

## STOP Conditions

Stop and surface the scope if:

- Including UI coverage requires more than five substantial new component/page tests in one pass.
- Typechecking TSX exposes a large unrelated typing migration outside the desktop UI.
- Tauri runtime globals make a UI entrypoint impossible to test without a broader test harness decision.

If a STOP condition triggers, write a smaller follow-up plan that restores TSX typecheck first and stages UI coverage by route.

## Acceptance Criteria

- `pnpm typecheck` checks TSX in `apps/desktop-companion/src/ui`.
- The root coverage config no longer excludes the entire `apps/**/src/ui/**` tree.
- Coverage includes at least one `apps/desktop-companion/src/ui` row.
- Full page/component UI coverage is either completed or explicitly deferred to the staged follow-up plan created when the STOP condition triggers.
- `pnpm coverage` still enforces 100% for the included surface.
- No UI test relies on timing sleeps where an event/mock assertion would be deterministic.

## Verification

```bash
pnpm typecheck
pnpm test
pnpm coverage
pnpm coverage 2>&1 | rg "apps/desktop-companion/src/ui|src/ui"
```

The final `rg` should find UI coverage rows. If the coverage reporter formats paths differently, inspect the full coverage table manually and record the observed UI rows in the implementation summary.

## Adversarial Self-Check

The biggest risk is turning this into coverage theater: shallow tests that click through rendered text but do not protect behavior. A skeptic should ask whether each added UI test would fail for a plausible user-facing regression. If not, rewrite it.
