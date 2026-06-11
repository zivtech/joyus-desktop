# Implementation Plan: Desktop Runtime Policy Enforcement

**Branch**: `001-desktop-runtime-policy-enforcement` | **Date**: 2026-03-05 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `kitty-specs/001-desktop-runtime-policy-enforcement/spec.md`

## Summary

Implement desktop-side policy enforcement and runtime routing for Joyus Desktop so privileged actions are always mediated by policy outcomes, external tenant execution is forced remote, and outage behavior is deterministic by risk tier.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 24  
**Primary Dependencies**: Vitest, TypeScript  
**Testing**: `pnpm typecheck`, `pnpm coverage` with 100% thresholds  
**Target Platform**: macOS/Linux development, GitHub Actions CI  
**Project Type**: Monorepo (`apps/*`, `packages/*`)

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| Open-Core Compatibility | PASS | Desktop logic consumes contracts; no server lock-in assumptions. |
| No Desktop Lock-In | PASS | Enforcement logic is portable and contract-based. |
| Security-First Enforcement | PASS | Policy outcome required for privileged action path. |
| Runtime Separation | PASS | Routing matrix enforces external remote path. |
| Full Coverage Gates | PASS | Coverage thresholds set to 100%. |

## Work Breakdown

1. Finalize authorization decision matrix in companion runtime.
2. Finalize runtime target selection matrix.
3. Finalize policy outage fail-closed matrix.
4. Add token/context validation guards in policy client module.
5. Add/maintain exhaustive test coverage for all branches.
6. Keep CI as hard gate for coverage + type checks.

## Risks

1. Control-plane token contract drift with `joyus-ai`.
2. Incomplete failure-path testing leading to policy bypass.
3. Routing regressions that allow external local execution.

## Exit Criteria

1. All acceptance scenarios in `spec.md` covered by automated tests.
2. `pnpm run ci` passes with 100% coverage.
3. No branch in authorization/routing modules is untested.
