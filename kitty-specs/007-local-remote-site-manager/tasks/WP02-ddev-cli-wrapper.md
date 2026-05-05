---
work_package_id: WP02
title: DDEV CLI Wrapper
dependencies:
- WP01
requirement_refs:
- FR-006
- FR-011
- FR-012
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts for this feature were generated on main. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into main unless the human explicitly redirects the landing branch.
subtasks:
- T006
- T007
- T008
- T009
- T010
history:
- date: '2026-04-01'
  action: created
  by: spec-kitty.tasks
authoritative_surface: 'src/ddevCli.ts'
execution_mode: code_change
mission_id: 01KPR4E967F61H0B7K24440QG5
owned_files:
- src/ddevCli.ts
- test/ddevCli.test.ts
tags: []
wp_code: WP02
---

# WP02: DDEV CLI Wrapper

**Implement with**: `spec-kitty implement WP02 --base WP01`

## Objective

Implement the DDEV CLI wrapper that executes commands with JSON output, parses the standard envelope, and classifies errors into plain-language messages suitable for non-technical users.

## Context

- **DDEV JSON envelope**: All DDEV commands with `-j` flag return `{ msg: string, level: "info"|"warning"|"error", raw: {...} }`
- **Error patterns**: DDEV returns exit code 1 for all errors; classify by matching stderr text
- **Reference**: `kitty-specs/007-local-remote-site-manager/research.md` — Section 2 (DDEV CLI Automation)
- **Dependency injection**: Use `ExecCommand` type from WP01's `runtimeDetector.ts` for testability

## Subtasks

### T006: Implement `ddevCli.ts`

**Purpose**: Type-safe wrapper around DDEV CLI commands with JSON parsing.

**Steps**:
1. Define DDEV output types:
   ```typescript
   export interface DdevEnvelope<T> { readonly msg: string; readonly level: "info" | "warning" | "error"; readonly raw: T; }
   export interface DdevProjectInfo { readonly name: string; readonly status: string; readonly approot: string; readonly httpurl: string; readonly httpsurl: string; readonly type: string; readonly services: Record<string, DdevServiceInfo>; }
   export interface DdevServiceInfo { readonly status: string; readonly fullName: string; }
   export interface DdevVersionInfo { readonly ddevVersion: string; readonly dockerPlatform: string; readonly dockerVersion: string; }
   ```
2. Implement `createDdevCli(execCommand: ExecCommand)` factory with methods:
   - `version()`: run `ddev version -j` → parse `DdevVersionInfo`
   - `list()`: run `ddev list -j` → parse array of `DdevProjectInfo`
   - `describe(projectName: string)`: run `ddev describe -j <name>` → parse `DdevProjectInfo`
   - `start(projectName: string)`: run `ddev start <name>` → check exit code
   - `stop(projectName: string)`: run `ddev stop <name>` → check exit code
   - `restart(projectName: string)`: run `ddev restart <name>` → check exit code
   - `delete(projectName: string)`: run `ddev delete -O -y <name>` → check exit code (skip snapshot + confirmation)
3. Each method: execute via `execCommand`, parse JSON with `JSON.parse`, validate envelope shape, extract `raw`
4. On non-zero exit code: throw a typed error with the classified message (see T007)

**Files**: `packages/local-provisioner/src/ddevCli.ts` (~120 lines)

### T007: Implement error classification

**Purpose**: Map raw DDEV error output to plain-language messages for PMs.

**Steps**:
1. Define error classifier function:
   ```typescript
   export function classifyDdevError(stderr: string): { type: DdevErrorType; message: string; suggestion: string } { ... }
   ```
2. Classification rules (match stderr text):
   - Contains `"Is the Docker daemon running?"` or `"Error response from daemon"` → type: `docker-not-running`, message: "Docker is not running", suggestion: "Start Docker Desktop or OrbStack and try again"
   - Contains `"port is already allocated"` or `"address already in use"` → type: `port-conflict`, message: "Another application is using a required port", suggestion: "Close the conflicting application or change the port in DDEV settings"
   - Contains `"is not a valid DDEV project"` → type: `missing-config`, message: "This project is not configured for local development", suggestion: "Contact the project's developer to add DDEV configuration"
   - Contains `"project ... does not exist"` → type: `project-not-found`, message: "This site was not found", suggestion: "The site may have been removed — try setting it up again"
   - Default → type: `unknown`, message: "Something went wrong", suggestion: "Check the details below for more information"
3. Define `DdevErrorType` enum and `DdevError` class extending `Error` with `type`, `message`, `suggestion`, and `details` (raw stderr)

**Files**: `packages/local-provisioner/src/ddevCli.ts` (within same file, ~40 lines)

### T008: Implement resource snapshot extraction

**Purpose**: Get CPU/memory usage for running DDEV site containers via Docker Engine API.

**Steps**:
1. Add method to `DdevCli` interface:
   ```typescript
   getContainerStats(projectName: string): Promise<ResourceSnapshot | undefined>
   ```
2. Implementation:
   - Call `ddev describe -j <name>` to get `raw.services.web.full_name` (Docker container name)
   - Call `dockerClient.listContainers()` to find container ID by name
   - Call `dockerClient.containerStats(containerId)` to get CPU/memory
   - Return `ResourceSnapshot` or `undefined` if site not running
3. Accept `DockerClient` as a constructor dependency

**Files**: `packages/local-provisioner/src/ddevCli.ts` (extend, ~30 lines)

### T009: Write tests for `ddevCli.test.ts`

**Steps**:
1. Mock `ExecCommand` to return JSON envelopes for each command
2. Test `version()`: valid JSON → parsed `DdevVersionInfo`
3. Test `list()`: array of projects → parsed list; empty array → empty list
4. Test `describe()`: full project info → parsed with services
5. Test `start()`/`stop()`/`restart()`: exit code 0 → success; exit code 1 → classified error
6. Test `delete()`: verify `-O -y` flags are passed
7. Test error classification: each pattern matches correctly; unknown errors get default message
8. Test malformed JSON response → throws parse error

**Files**: `packages/local-provisioner/test/ddevCli.test.ts`

### T010: Write tests for resource snapshot

**Steps**:
1. Mock `DdevCli.describe()` to return container name
2. Mock `DockerClient.listContainers()` to return matching container
3. Mock `DockerClient.containerStats()` to return CPU/memory data
4. Test: running site → `ResourceSnapshot` with correct values
5. Test: stopped site (container not found) → `undefined`
6. Test: Docker API error → `undefined` (graceful degradation)

**Files**: `packages/local-provisioner/test/ddevCli.test.ts` (within same file)

## Definition of Done

- [ ] `ddevCli.ts` wraps all 7 DDEV commands with JSON parsing
- [ ] Error classifier maps 4 known error patterns + unknown fallback
- [ ] Resource snapshot reads Docker stats for DDEV containers
- [ ] All tests pass, 100% coverage
- [ ] Errors produce plain-language messages suitable for non-technical users

## Risks

- **DDEV JSON format changes**: Pin minimum DDEV version in docs; validate envelope shape defensively
- **Container name format**: DDEV container naming convention may vary — use `ddev describe -j` as the authority rather than constructing names
