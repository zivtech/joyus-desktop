---
work_package_id: WP01
title: Docker Runtime Detection
dependencies: []
requirement_refs: [FR-001, FR-002]
planning_base_branch: claude/channels-spec-005-amendment
merge_target_branch: claude/channels-spec-005-amendment
branch_strategy: Planning artifacts for this feature were generated on claude/channels-spec-005-amendment. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into claude/channels-spec-005-amendment unless the human explicitly redirects the landing branch.
subtasks: [T001, T002, T003, T004, T005]
history:
- date: '2026-04-01'
  action: created
  by: spec-kitty.tasks
authoritative_surface: ''
execution_mode: code_change
mission_id: 01KPR4E967F61H0B7K24440QG5
owned_files:
- kitty-specs/007-local-remote-site-manager/contracts/local-provisioner.ts
- kitty-specs/007-local-remote-site-manager/research.md
- src/dockerClient.ts
- src/index.ts
- src/runtimeDetector.ts
- test/dockerClient.test.ts
- test/runtimeDetector.test.ts
wp_code: WP01
---

# WP01: Docker Runtime Detection

**Implement with**: `spec-kitty implement WP01`

## Objective

Scaffold the `packages/local-provisioner` package and implement the Docker Engine API client + runtime detector. This is the foundation for all local site operations — the app must detect whether Docker/OrbStack and DDEV are installed and running before it can provision sites.

## Context

- **Monorepo pattern**: Follow `packages/session-manager` conventions — ESM, strict TypeScript, factory functions, `node:sqlite`, readonly interfaces
- **Package.json**: `@joyus/local-provisioner`, private, `"type": "module"`, exports `"./src/index.ts"`
- **No new npm dependencies**: Use `node:http` for Docker API, `node:child_process` for DDEV CLI, `node:fs` for socket detection
- **Reference**: See `kitty-specs/007-local-remote-site-manager/research.md` for socket paths and API details
- **Contracts**: See `kitty-specs/007-local-remote-site-manager/contracts/local-provisioner.ts` for interface definitions

## Subtasks

### T001: Scaffold `packages/local-provisioner`

**Purpose**: Create the package structure matching monorepo conventions.

**Steps**:
1. Create `packages/local-provisioner/package.json`:
   ```json
   {
     "name": "@joyus/local-provisioner",
     "private": true,
     "version": "0.1.0",
     "type": "module",
     "exports": { ".": "./src/index.ts" }
   }
   ```
2. Create `packages/local-provisioner/src/index.ts` — empty initially, will export as modules are built
3. Verify `pnpm install` succeeds and `pnpm typecheck` includes the new package

**Files**: `packages/local-provisioner/package.json`, `packages/local-provisioner/src/index.ts`

### T002: Implement `dockerClient.ts`

**Purpose**: Minimal Docker Engine API client that communicates over Unix socket (macOS) or named pipe (Windows).

**Steps**:
1. Define types:
   ```typescript
   export interface DockerPingResult { readonly alive: boolean; readonly apiVersion: string | undefined; }
   export interface DockerInfo { readonly serverVersion: string; readonly ncpu: number; readonly memTotal: number; readonly containers: number; readonly containersRunning: number; readonly operatingSystem: string; }
   export interface ContainerListEntry { readonly id: string; readonly names: readonly string[]; readonly image: string; readonly state: string; readonly status: string; }
   export interface ContainerStats { readonly cpuPercent: number; readonly memoryUsageBytes: number; readonly memoryLimitBytes: number; }
   ```
2. Implement `createDockerClient(socketPath: string)` factory:
   - `ping()`: `GET /_ping` → parse 200 OK as alive, read `Api-Version` header
   - `info()`: `GET /info` → parse JSON, extract `ServerVersion`, `NCPU`, `MemTotal`, `Containers`, `ContainersRunning`, `OperatingSystem`
   - `listContainers()`: `GET /containers/json` → parse JSON array
   - `containerStats(id: string)`: `GET /containers/{id}/stats?stream=false` → parse JSON, compute CPU % from delta formula:
     ```
     cpuDelta = cpu_stats.cpu_usage.total_usage - precpu_stats.cpu_usage.total_usage
     systemDelta = cpu_stats.system_cpu_usage - precpu_stats.system_cpu_usage
     cpuPercent = (cpuDelta / systemDelta) * cpu_stats.online_cpus * 100
     ```
3. Use `node:http` `request()` with `socketPath` option for macOS/Linux
4. For Windows named pipe: use `socketPath: '//./pipe/docker_engine'` (Node.js `http` supports this on Windows)
5. All methods return typed results or throw on connection/parse failure
6. Set reasonable timeout (5 seconds) on all requests

**Files**: `packages/local-provisioner/src/dockerClient.ts` (~120 lines)

### T003: Implement `runtimeDetector.ts`

**Purpose**: Detect Docker/OrbStack installation and DDEV installation by probing sockets and CLI tools.

**Steps**:
1. Define socket probe order for macOS:
   ```typescript
   const MACOS_SOCKETS = [
     process.env['DOCKER_HOST']?.replace('unix://', ''),
     `${homedir()}/.docker/run/docker.sock`,
     `${homedir()}/.orbstack/run/docker.sock`,
     '/var/run/docker.sock',
   ].filter(Boolean);
   ```
2. Windows: probe `'//./pipe/docker_engine'` or `DOCKER_HOST` env var
3. Implement `createRuntimeDetector(execCommand: ExecCommand)` factory:
   - `check()` method:
     a. Iterate socket paths, check existence with `fs.accessSync`
     b. For the first accessible socket, create a `DockerClient` and call `ping()` + `info()`
     c. Determine provider: if socket path contains `.orbstack` → `"orbstack"`, else `"docker-desktop"`
     d. Check DDEV: `execCommand(['ddev', 'version', '-j'])`, parse `raw.ddev_version` and `raw.docker_platform`
     e. Return `RuntimeCheckResult`
   - `installContainerRuntime(provider)` — shell out to `brew install --cask orbstack` or `brew install --cask docker` (macOS); placeholder for Windows
   - `installDdev()` — shell out to `brew install ddev/ddev/ddev` (macOS); placeholder for Windows
4. Inject `ExecCommand` type (similar to `ExecGit` in session-manager) for testability:
   ```typescript
   export type ExecCommand = (args: readonly string[], cwd?: string) => Promise<{ stdout: string; stderr: string }>;
   ```

**Files**: `packages/local-provisioner/src/runtimeDetector.ts` (~100 lines)

### T004: Write tests for `dockerClient.test.ts`

**Purpose**: Verify Docker Engine API client handles all response scenarios.

**Steps**:
1. Mock HTTP responses for each endpoint:
   - `ping()`: 200 with `OK` body → alive; connection refused → not alive
   - `info()`: valid JSON → parsed fields; malformed JSON → throws
   - `listContainers()`: array of containers; empty array
   - `containerStats()`: valid stats with CPU delta calculation; edge case where systemDelta is 0
2. Test timeout handling — mock slow response
3. Test socket path handling — verify `socketPath` passed to `http.request`

**Files**: `packages/local-provisioner/test/dockerClient.test.ts`

### T005: Write tests for `runtimeDetector.test.ts`

**Purpose**: Verify runtime detection across platform and installation scenarios.

**Steps**:
1. Mock `fs.accessSync` to simulate socket presence/absence
2. Mock `ExecCommand` for DDEV version check
3. Test scenarios:
   - OrbStack installed and running → detected as `"orbstack"`
   - Docker Desktop installed and running → detected as `"docker-desktop"`
   - No Docker installed → `dockerInstalled: false`
   - Docker installed but not running → `dockerRunning: false`
   - DDEV installed → `ddevInstalled: true` with version
   - DDEV not installed → `ddevInstalled: false`
   - `DOCKER_HOST` env var overrides socket probe order

**Files**: `packages/local-provisioner/test/runtimeDetector.test.ts`

## Definition of Done

- [ ] `packages/local-provisioner` exists with correct package.json
- [ ] `pnpm typecheck` passes with the new package
- [ ] `dockerClient.ts` implements all 4 API methods with typed responses
- [ ] `runtimeDetector.ts` probes sockets in correct order and reports full `RuntimeCheckResult`
- [ ] All tests pass with `pnpm vitest run packages/local-provisioner/test/`
- [ ] 100% coverage on `dockerClient.ts` and `runtimeDetector.ts`
- [ ] `index.ts` exports all public types and factory functions

## Risks

- **Windows named pipe**: `node:http` may not support named pipes directly on all Node versions. Verify during implementation; if blocked, implement a raw `net.createConnection` adapter.
- **Socket permissions**: macOS socket access may require user to be in the `docker` group. The detector should report permission errors as "Docker installed but inaccessible" rather than "not installed".
