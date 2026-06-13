# Plan 002: Dedupe Vitest Unit Test Discovery

## Summary

The root Vitest unit config discovers tests under `node_modules`, causing workspace package tests to run more than once. This inflates the test count, slows feedback, and makes the test gate less trustworthy.

## Priority

- Priority: P1
- Risk: Medium
- Effort: Small
- Dependencies: None

## What This Is Not Claiming

- This plan is not claiming tests are currently failing.
- This plan is not claiming duplicated test execution changes runtime behavior.
- This plan is claiming the current green signal is noisier and less meaningful than it should be.

## Evidence

- `vitest.config.ts:6-7` includes `**/test/**/*.test.ts`, excluding only `.worktrees/**` and `**/**.integration.test.ts`.
- `vitest.integration.config.ts:6-7` already excludes `**/node_modules/**`.
- An audit run of `pnpm test` passed, but ran 386 files and 6823 tests.
- The same output included duplicated workspace paths under:
  - `node_modules/.pnpm/node_modules/@joyus/...`
  - `apps/desktop-companion/node_modules/@joyus/...`

## Implementation Steps

1. Update `vitest.config.ts`.
   - Add `**/node_modules/**` to `test.exclude`.
   - Also exclude generated/build output directories that should never be unit-test sources:
     - `**/dist/**`
     - `**/dist-ui/**`
     - `**/coverage/**`
     - `apps/**/src-tauri/target/**`
   - Keep the existing `.worktrees/**` and integration-test exclusions.

2. Keep the integration config aligned.
   - `vitest.integration.config.ts` already excludes `**/node_modules/**`.
   - Add the same generated/build exclusions only if they are missing and applicable.

3. Do not broaden test include patterns in this plan.
   - This plan should only remove accidental duplicate discovery.
   - UI typecheck/coverage changes belong in Plan 003.

## Acceptance Criteria

- `pnpm test` exits 0.
- `pnpm test` output no longer contains duplicated test paths under `node_modules/.pnpm/node_modules/@joyus` or `apps/desktop-companion/node_modules/@joyus`.
- No legitimate tests under `apps/*/test` or `packages/*/test` are excluded.
- `pnpm coverage` still exits 0.

## Verification

Use a temporary log outside the repository:

```bash
pnpm test 2>&1 | tee /tmp/joyus-desktop-vitest.log
rg "node_modules/.pnpm/node_modules/@joyus|apps/desktop-companion/node_modules/@joyus" /tmp/joyus-desktop-vitest.log
```

The `rg` command should return no matches and exit non-zero. Then run:

```bash
pnpm coverage
pnpm typecheck
```

## Adversarial Self-Check

The main risk is over-excluding. Before committing, inspect the final test file list in the Vitest output and make sure real workspace tests still run from `apps/.../test` and `packages/.../test`.
