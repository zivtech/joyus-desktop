# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
pnpm install              # Install all workspace dependencies
pnpm typecheck            # TypeScript strict checking (tsc --noEmit)
pnpm test                 # Run tests (vitest run)
pnpm coverage             # Run tests with 100% coverage enforcement
pnpm run ci               # Full CI pipeline: typecheck + coverage + integration tests
# Never run `pnpm ci` (without `run`): in pnpm that is clean-install, not this script.
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

All three gates must pass for CI to merge:
- **Typecheck**: `pnpm typecheck` — strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
- **Coverage**: `pnpm coverage` — **100% threshold** on lines, functions, branches, and statements (v8 provider)
- **Integration**: `pnpm test:integration` — runs `*.integration.test.ts` files with `vitest.integration.config.ts`

Coverage includes all `apps/**/src/**/*.ts` and `packages/**/src/**/*.ts`, plus the UI files listed under `coverage.include` in `vitest.config.ts`. A UI component that is not in that list is not measured. Tests live in `{package}/test/*.test.ts`.

## Architecture

pnpm monorepo (workspaces: `apps/*`, `packages/*`). All packages are ESM (`"type": "module"`), TypeScript strict, targeting ES2022.

### Packages

- **`packages/policy-client`** (`@joyus/policy-client`) — Policy decision client, handoff state machine, handoff contracts/verification, snapshot encryption, control plane contracts
- **`packages/session-agent`** (`@joyus/session-agent`) — Session health signaling, output ledger, local-vs-remote runtime routing
- **`packages/session-manager`** (`@joyus/session-manager`) — SQLite-backed TaskBranch store, git worktree lifecycle, file modification detection (IPC + polling), SessionManager with managed/advisory modes
- **`packages/drift-detector`** (`@joyus/drift-detector`) — Topic-domain heuristics engine, DriftDetector with per-session state and dismissal tracking
- **`packages/skill-sync`** (`@joyus/skill-sync`) — Skill distribution CLI and library: sync engine with git operations, version pinning, distribution config management
- **`packages/updater`** (`@joyus/updater`) — Update management
- **`packages/desktop-sync`** (`@joyus/desktop-sync`) — Local clone lifecycle and sync orchestration helpers
- **`packages/mcp-registry`** (`@joyus/mcp-registry`) — MCP registration, Claude Code integration, process management, and updater wiring
- **`packages/mcp-governance`** (`@joyus/mcp-governance`) — Governance enforcement and MCP telemetry hooks
- **`packages/mcp-tools-compat`** (`@joyus/mcp-tools-compat`) — Compatibility helpers for MCP tool wrappers
- **`packages/telemetry`** (`@joyus/telemetry`) — CLI/Cowork telemetry collection, opt-out handling, and usage reporting
- **`packages/local-provisioner`** (`@joyus/local-provisioner`) — Local site provisioning and runtime detection for DDEV/container workflows
- **`packages/environment-monitor`** (`@joyus/environment-monitor`) — Remote environment discovery, polling, identity, and activity tracking
- **`packages/settings-reconciler`** (`@joyus/settings-reconciler`) — Non-destructive managed settings and MCP entry reconciliation

### Application

- **`apps/desktop-companion`** (`@joyus/desktop-companion`) — Main desktop app orchestrating authorization, handoff (upload + orchestration), runtime execution, and snapshot assembly. Depends on `policy-client`, `session-agent`, and `tus-js-client`.

### Key Domain Flows

1. **Handoff flow**: `handoffAuthorization` -> `handoffOrchestrator` -> `handoffUpload` (tus-based resumable uploads) -> `snapshotAssembly`, governed by `handoffStateMachine` in policy-client
2. **Runtime flow**: `authorization` -> `runtimeOrchestrator` -> `runtimeExecution`, with routing decisions from session-agent's `runtimeRouting`
3. **Policy enforcement**: `policyClient` makes decisions using `controlPlaneContracts`, verified by `handoffVerification`

**Integration status (checked 2026-11-17):** the three flows above are library code with unit tests. The desktop sidecar (`apps/desktop-companion/src/sidecar/`) and the UI do not import them, and the sidecar does not import `@joyus/policy-client` or `@joyus/session-agent`. Do not assume these flows run in the packaged app. Before relying on any cross-layer behavior, check that the UI command, the Rust command in `src-tauri/src/main.rs`, and the sidecar method all exist under the same name.

## Security Context

Threat model focuses on: token replay, cross-tenant data access, policy bypass during outages, artifact provenance tampering. See `docs/threat-model.md`.

## Spec-Driven Development

Feature specs live in `kitty-specs/{NNN}-{feature}/` with `spec.md`, `plan.md`, and `tasks.md` (or `tasks/` directory). These track work packages through planned -> doing -> done states.
