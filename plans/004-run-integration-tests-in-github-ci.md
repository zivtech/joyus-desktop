# Plan 004: Run Integration Tests In GitHub CI

## Summary

The repository-level `pnpm run ci` script includes integration tests, but the GitHub CI workflow does not run that script. Instead, it runs only typecheck and coverage. This means local CI and hosted CI are not equivalent.

Harsh-critic revision note: this plan covers CI parity only. Desktop dogfood build signing needs a separate release-hardening pass because `.github/workflows/build-desktop.yml` claims ad-hoc/self-signed builds but contains signing-condition logic that may not match current GitHub Actions behavior.

## Priority

- Priority: P1
- Risk: Medium
- Effort: Small to Medium
- Dependencies: Plan 002 recommended first.

## What This Is Not Claiming

- This plan is not claiming integration tests currently fail.
- This plan is not claiming every workflow should use the exact same command shape.
- This plan is claiming the primary CI workflow omits a gate that the package scripts and contributor docs define as part of CI.

## Evidence

- `package.json:12` defines `ci` as `pnpm typecheck && pnpm coverage && pnpm test:integration`.
- `.github/workflows/ci.yml:28-32` runs `pnpm typecheck` and `pnpm coverage`, but not `pnpm test:integration`.
- `CONTRIBUTING.md:46` tells contributors to run `pnpm run ci`.
- `vitest.integration.config.ts:6-7` exists and has its own integration-test include/exclude config.

## Implementation Steps

1. Decide whether the workflow should call `pnpm run ci` or keep named steps.
   - Preferred: replace the separate typecheck and coverage steps with a single `pnpm run ci` step if the coverage artifact upload still works afterward.
   - Acceptable: keep the existing typecheck and coverage steps, then add an explicit `pnpm test:integration` step.

2. Preserve coverage artifact upload.
   - If the workflow uploads coverage output later, confirm the chosen command still writes the same coverage directory.

3. Keep failure attribution readable.
   - If maintainers prefer separate GitHub check sections, use separate steps:
     - Typecheck
     - Coverage
     - Integration Tests
   - If maintainers prefer parity with local usage, use `pnpm run ci`.

4. Update docs only if the command shape changes.
   - If `.github/workflows/ci.yml` uses `pnpm run ci`, no contributor doc change is needed.
   - If the package script changes, update `CONTRIBUTING.md` in the same commit.

## Acceptance Criteria

- The main GitHub CI workflow runs integration tests through either `pnpm run ci` or an explicit `pnpm test:integration` step.
- Local `pnpm run ci` exits 0.
- Coverage upload behavior is preserved.
- The workflow does not duplicate unit tests through `node_modules` after Plan 002.
- A separate build-workflow follow-up remains tracked unless current Build Desktop status is verified and fixed.

## Verification

```bash
pnpm test:integration
pnpm run ci
```

If GitHub Actions tooling is available locally, optionally run a workflow dry run. Otherwise, inspect `.github/workflows/ci.yml` to confirm the step order and commands.

## Adversarial Self-Check

The weak point is runtime cost. If integration tests are too slow for every push, do not silently omit them. Instead, make that a deliberate policy decision in the workflow, such as running them on pull requests and protected branches.
