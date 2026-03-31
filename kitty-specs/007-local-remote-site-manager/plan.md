# Implementation Plan: Local & Remote Site Manager

**Branch**: `007-local-remote-site-manager` | **Date**: 2026-03-31 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/kitty-specs/007-local-remote-site-manager/spec.md`

## Summary

The Joyus Desktop app needs to provision, manage, and monitor site environments across two tracks: local Docker/DDEV environments for Zivtech PMs/ops, and remote Probo/joyus-ai environments for clients. The feature is split into two packages — `packages/local-provisioner` for local DDEV operations via Docker Engine API + DDEV CLI, and `packages/environment-monitor` for remote environment tracking via GitHub Deployments API + `gh` CLI. Both use separate SQLite databases following existing `node:sqlite` patterns. No new npm dependencies required.

## Technical Context

**Language/Version**: TypeScript strict, ES2022, ESM
**Primary Dependencies**: `node:sqlite`, `node:http`, `node:child_process`, `node:fs` (all Node.js built-ins)
**Storage**: SQLite via `node:sqlite` `DatabaseSync` — two separate database files (`~/.joyus/local-provisioner.db`, `~/.joyus/environment-monitor.db`)
**Testing**: vitest, 100% coverage enforced (v8 provider)
**Target Platform**: macOS (day 1), Windows (day 1) — matching Feature 004
**Performance Goals**: Local site lifecycle actions complete within 30s; Probo URLs appear in panel within 60s of environment ready
**Constraints**: No new npm dependencies; all external tools (ddev, gh, docker, git) injected as dependencies for testability
**Scale/Scope**: Tens of local sites per machine; hundreds of remote environments across repos

## Constitution Check

*Skipped — no constitution file configured for this project.*

## Project Structure

### Documentation (this feature)

```
kitty-specs/007-local-remote-site-manager/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 research findings
├── data-model.md        # Entity schemas and relationships
├── quickstart.md        # Developer setup guide
├── contracts/
│   ├── local-provisioner.ts    # Internal API contracts
│   └── environment-monitor.ts  # Internal API contracts
└── checklists/
    └── requirements.md  # Spec quality checklist
```

### Source Code (repository root)

```
packages/local-provisioner/
├── src/
│   ├── index.ts                # Public exports
│   ├── runtimeDetector.ts      # Docker socket probing + DDEV detection
│   ├── dockerClient.ts         # Minimal Docker Engine API (HTTP over socket)
│   ├── ddevCli.ts              # DDEV CLI wrapper with JSON parsing
│   ├── localSiteStore.ts       # SQLite persistence
│   └── localSiteManager.ts     # Orchestrator
├── test/
│   ├── runtimeDetector.test.ts
│   ├── dockerClient.test.ts
│   ├── ddevCli.test.ts
│   ├── localSiteStore.test.ts
│   └── localSiteManager.test.ts
└── package.json

packages/environment-monitor/
├── src/
│   ├── index.ts                 # Public exports
│   ├── deploymentStatusPoller.ts # GitHub Deployments API via gh CLI
│   ├── proboDetector.ts         # .probo.yaml presence check
│   ├── remoteEnvironmentStore.ts # SQLite persistence
│   ├── activityLog.ts           # Event log (30-day retention)
│   ├── projectDiscovery.ts      # Chained discovery (GitHub + admin + manual)
│   ├── userIdentity.ts          # Internal vs client via GitHub org / Google domain
│   └── environmentMonitor.ts    # Orchestrator
├── test/
│   ├── deploymentStatusPoller.test.ts
│   ├── proboDetector.test.ts
│   ├── remoteEnvironmentStore.test.ts
│   ├── activityLog.test.ts
│   ├── projectDiscovery.test.ts
│   ├── userIdentity.test.ts
│   └── environmentMonitor.test.ts
└── package.json
```

**Structure Decision**: Two new packages in the existing pnpm monorepo, following the same conventions as `packages/session-manager` (factory functions, `node:sqlite`, readonly interfaces, soft deletes). No changes to existing packages except consuming `@joyus/session-manager` exports for cross-feature correlation.

## Architecture Decisions

### AD-1: Docker Engine API for Runtime Detection

Use raw HTTP over Unix socket (`node:http` with `socketPath`) on macOS, named pipe adapter on Windows. Three endpoints: `GET /_ping` (liveness), `GET /info` (system metadata), `GET /containers/{id}/stats?stream=false` (resource usage). No `dockerode` dependency — the API surface is small enough for a minimal client.

Socket probe order (macOS): `DOCKER_HOST` → `$HOME/.docker/run/docker.sock` → `$HOME/.orbstack/run/docker.sock` → `/var/run/docker.sock`

### AD-2: DDEV CLI as the Only Site Operations Interface

Shell out to DDEV CLI with `-j` flag for all site operations. Parse the standard envelope `{ msg, level, raw }`. DDEV has no programmatic API — the CLI is the stable interface. Error classification by matching stderr patterns against known strings.

### AD-3: `gh api` for GitHub Deployments

Use `gh api` CLI (already authenticated) for all GitHub API calls. No Octokit dependency. Query deployments by PR head SHA, read `environment_url` from deployment statuses. Map GitHub deployment states to `RemoteEnvironmentStatus`.

### AD-4: Separate SQLite Databases Per Package

Each package manages its own SQLite file. Cross-feature correlation (TaskBranch → RemoteEnvironment) happens in application code, not SQL joins. This preserves clean package boundaries and avoids schema coupling with `session-manager`.

### AD-5: Event-Driven + Fallback Polling

When Feature 006 pushes a branch and creates a PR, it emits an event that triggers an immediate GitHub deployment status check. A 60-second background poll catches anything the event-driven path misses. Polling respects GitHub API rate limits (5000/hour authenticated).

### AD-6: Command Injection for Testability

All external commands (ddev, gh, docker socket, git, execFile) are injected as dependencies into factory functions. Tests provide mock implementations. No real Docker, DDEV, or GitHub API calls in unit tests.

## Implementation Sequence

### Phase 1: local-provisioner (foundation)

Build bottom-up within the package:

1. **dockerClient.ts** — Socket probing, `/_ping`, `/info`, `/containers/json`, `/containers/{id}/stats`
2. **runtimeDetector.ts** — Uses dockerClient + DDEV version check. Produces `RuntimeCheckResult`
3. **ddevCli.ts** — Wrapper for `ddev start/stop/restart/delete/describe/list/version` with JSON parsing and error classification
4. **localSiteStore.ts** — SQLite CRUD for `LocalSite` entity
5. **localSiteManager.ts** — Orchestrator: clone repo → ddev start → persist → lifecycle management

### Phase 2: environment-monitor (foundation)

Build bottom-up within the package:

1. **proboDetector.ts** — Check `.probo.yaml` existence
2. **remoteEnvironmentStore.ts** — SQLite CRUD for `RemoteEnvironment` entity
3. **activityLog.ts** — SQLite event log with append, query, prune
4. **deploymentStatusPoller.ts** — `gh api` wrapper for deployment status queries, state mapping, polling loop
5. **userIdentity.ts** — `gh api /user/orgs` for org check, Google domain check
6. **projectDiscovery.ts** — GitHub org repos + admin list + manual URL, deduplication
7. **environmentMonitor.ts** — Orchestrator: event handling, polling lifecycle, cross-feature integration

### Phase 3: Cross-Feature Integration

1. **Event bridge**: Connect `session-manager` push/PR events to `environment-monitor.onPrCreated()`
2. **TaskBranch correlation**: Read `task_branch_id` from session-manager store, populate on RemoteEnvironment
3. **Unified site panel data**: Combine `localSiteManager.listAll()` + `environmentMonitor.listAll()` into a single view model

### Phase 4: Feature 006 Amendments

Implement the new FRs added to Feature 006 during this spec cycle:

1. **FR-018**: Push-to-remote on session close (managed mode)
2. **FR-019**: Draft PR creation via `gh pr create --draft`
3. **FR-020**: PR association fields on TaskBranch entity (schema migration)
4. **FR-023**: Auto-commit behavior (silent for desktop GUI, prompted for CLI)
5. **FR-021/FR-022**: Panel display + advisory mode confirmation

### Phase 5: Acceptance & Edge Cases

1. End-to-end flow testing: session close → push → PR → Probo → site manager
2. Error scenarios: port conflicts, missing config, network failures, rate limiting
3. Offline mode: local sites work, remote status cached with timestamps
4. Platform testing: macOS + Windows

## Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| DDEV CLI output format changes between versions | Medium | Pin minimum DDEV version, validate JSON envelope shape |
| Docker socket paths vary by Docker Desktop version | Medium | Ordered probe with fallback chain |
| Probo uses non-standard deployment event format | High | Verify with a real Probo repo during Phase 2 |
| `gh` CLI not authenticated | Medium | Detect and surface plain-language auth instructions |
| Feature 006 event mechanism not yet defined | Medium | Define a minimal EventEmitter interface in Phase 3; 006 implementation adopts it |
| Windows named pipe handling in `node:http` | Medium | May need custom agent; research confirmed the pattern |

## Dependency on Feature 006

This feature depends on Feature 006 amendments (FR-018–FR-023) being implemented. The recommended approach:

- **Phase 1–2** (local-provisioner + environment-monitor) can proceed independently
- **Phase 3** (cross-feature integration) requires 006's push/PR/event infrastructure
- **Phase 4** implements the 006 amendments themselves

If 006 amendments are not ready when Phase 3 begins, the environment monitor can still work with manual PR number input as a stopgap.
