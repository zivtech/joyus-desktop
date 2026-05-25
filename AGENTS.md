# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
pnpm install              # Install all workspace dependencies
pnpm typecheck            # TypeScript strict checking (tsc --noEmit)
pnpm test                 # Run tests (vitest run)
pnpm coverage             # Run tests with 100% coverage enforcement
pnpm ci                   # Full CI pipeline: typecheck + coverage
```

Run a single test file:
```bash
pnpm vitest run packages/policy-client/test/policyClient.test.ts
```

Skill-sync utilities:
```bash
pnpm skill-sync:hook:install    # Install skill-sync startup hook
pnpm skill-sync:hook:preview    # Dry-run hook installation
pnpm skill-sync:tester          # Run validation checklist
pnpm skill-sync:verify-pin      # Verify version pin propagation
```

## Quality Gates

Both gates must pass for CI to merge:
- **Typecheck**: `pnpm typecheck` — strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
- **Coverage**: `pnpm coverage` — **100% threshold** on lines, functions, branches, and statements (v8 provider)

Coverage includes all `apps/**/src/**/*.ts` and `packages/**/src/**/*.ts`. Tests live in `{package}/test/*.test.ts`.

## Architecture

pnpm monorepo (workspaces: `apps/*`, `packages/*`). All packages are ESM (`"type": "module"`), TypeScript strict, targeting ES2022.

### Packages

- **`packages/policy-client`** (`@joyus/policy-client`) — Policy decision client, handoff state machine, handoff contracts/verification, snapshot encryption, control plane contracts
- **`packages/session-agent`** (`@joyus/session-agent`) — Session health signaling, output ledger, local-vs-remote runtime routing
- **`packages/session-manager`** (`@joyus/session-manager`) — SQLite-backed TaskBranch store, git worktree lifecycle, file modification detection (IPC + polling), SessionManager with managed/advisory modes
- **`packages/drift-detector`** (`@joyus/drift-detector`) — Topic-domain heuristics engine, DriftDetector with per-session state and dismissal tracking
- **`packages/skill-sync`** (`@joyus/skill-sync`) — Skill distribution CLI and library: sync engine with git operations, version pinning, distribution config management
- **`packages/updater`** (`@joyus/updater`) — Update management

### Application

- **`apps/desktop-companion`** (`@joyus/desktop-companion`) — Main desktop app orchestrating authorization, handoff (upload + orchestration), runtime execution, and snapshot assembly. Depends on `policy-client`, `session-agent`, and `tus-js-client`.

### Key Domain Flows

1. **Handoff flow**: `handoffAuthorization` -> `handoffOrchestrator` -> `handoffUpload` (tus-based resumable uploads) -> `snapshotAssembly`, governed by `handoffStateMachine` in policy-client
2. **Runtime flow**: `authorization` -> `runtimeOrchestrator` -> `runtimeExecution`, with routing decisions from session-agent's `runtimeRouting`
3. **Policy enforcement**: `policyClient` makes decisions using `controlPlaneContracts`, verified by `handoffVerification`

## Security Context

Threat model focuses on: token replay, cross-tenant data access, policy bypass during outages, artifact provenance tampering. See `docs/threat-model.md`.

## Spec-Driven Development

Feature specs live in `kitty-specs/{NNN}-{feature}/` with `spec.md`, `plan.md`, and `tasks.md` (or `tasks/` directory). These track work packages through planned -> doing -> done states.
