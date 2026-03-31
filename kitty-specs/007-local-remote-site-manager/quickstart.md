# Quickstart: Feature 007 — Local & Remote Site Manager

## New Packages

```bash
# After scaffolding:
pnpm install
pnpm typecheck
pnpm test
```

### packages/local-provisioner

Manages local DDEV-based site environments. Detects Docker/OrbStack runtime, installs DDEV, provisions sites via CLI.

```
packages/local-provisioner/
├── src/
│   ├── index.ts                # Public exports
│   ├── runtimeDetector.ts      # Docker socket probing + DDEV detection
│   ├── dockerClient.ts         # Minimal Docker Engine API client (HTTP over socket)
│   ├── ddevCli.ts              # DDEV CLI wrapper with JSON parsing
│   ├── localSiteStore.ts       # SQLite persistence (node:sqlite)
│   └── localSiteManager.ts     # Orchestrator: provision, start, stop, remove
├── test/
│   ├── runtimeDetector.test.ts
│   ├── dockerClient.test.ts
│   ├── ddevCli.test.ts
│   ├── localSiteStore.test.ts
│   └── localSiteManager.test.ts
└── package.json
```

**Key patterns**:
- Factory functions (no classes) — matches `session-manager` conventions
- `node:sqlite` `DatabaseSync` for persistence — matches `taskBranchStore.ts`
- Readonly interfaces, soft deletes with `deleted_at`
- Shell execution via `node:child_process` `execFile` for DDEV/git
- HTTP over Unix socket via `node:http` for Docker Engine API

### packages/environment-monitor

Monitors remote environments (Probo + joyus-ai hosted). Polls GitHub deployments, manages activity log.

```
packages/environment-monitor/
├── src/
│   ├── index.ts                 # Public exports
│   ├── deploymentStatusPoller.ts # GitHub Deployments API via gh CLI
│   ├── proboDetector.ts         # .probo.yaml presence check
│   ├── remoteEnvironmentStore.ts # SQLite persistence
│   ├── activityLog.ts           # SQLite-backed event log
│   ├── projectDiscovery.ts      # Chained project discovery (GitHub + admin + manual)
│   ├── userIdentity.ts          # Internal vs client determination
│   └── environmentMonitor.ts    # Orchestrator: polling, event handling, lifecycle
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

**Key patterns**:
- `gh api` via `execFile` for GitHub API calls — no new npm dependencies
- Event-driven polling with 60s fallback interval
- Activity log in same SQLite database as remote environments
- 30-day retention with pruning on startup

## Dependencies

**No new npm dependencies required.** Both packages use:
- `node:sqlite` (DatabaseSync) — already used by session-manager
- `node:http` — for Docker Engine API calls
- `node:child_process` (execFile) — for DDEV CLI, git, gh CLI
- `node:fs`, `node:path`, `node:os`, `node:crypto` — standard lib

## Testing

```bash
# Run all tests
pnpm test

# Run specific package
pnpm vitest run packages/local-provisioner/test/
pnpm vitest run packages/environment-monitor/test/

# Coverage (100% enforced)
pnpm coverage
```

All external commands (ddev, gh, docker, git) are injected as dependencies for testability. Tests use mock implementations — no real Docker, DDEV, or GitHub API calls in unit tests.

## Cross-Feature Integration

Feature 007 consumes data from Feature 006 (session-manager):

```typescript
// environment-monitor reads TaskBranch PR data from session-manager
import { openTaskBranchStore } from "@joyus/session-manager";

const store = openTaskBranchStore();
const branch = store.findById(taskBranchId);
// branch.prNumber, branch.prUrl → correlate with RemoteEnvironment
```

Feature 006's `SessionManager` will emit events (push complete, PR created) that Feature 007's `EnvironmentMonitor.onPrCreated()` consumes. The event mechanism is defined during 006's FR-018/FR-019 implementation.
