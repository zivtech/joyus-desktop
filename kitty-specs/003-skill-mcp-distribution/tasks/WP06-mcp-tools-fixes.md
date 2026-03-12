---
work_package_id: "WP06"
title: "Fix zivtech-mcp-tools Critical Issues"
lane: "doing"
dependencies: []
subtasks:
  - "T031"
  - "T032"
  - "T033"
  - "T034"
  - "T035"
  - "T036"
  - "T037"
  - "T038"
  - "T066"
phase: "Phase 2 - Desktop Companion"
assignee: ""
agent: "claude-opus"
shell_pid: "79561"
review_status: ""
reviewed_by: ""
history:
  - timestamp: "2026-03-10T00:00:00Z"
    lane: "planned"
    agent: ""
    action: "Prompt generated"
---

# Work Package Prompt: WP06 - Fix zivtech-mcp-tools Critical Issues

## Objective

Fix all critical and major bugs in the `zivtech-mcp-tools` monorepo so that MCP servers build cleanly, run without crashes, and can be distributed by the desktop companion.

## Context

Prior audit of `zivtech-mcp-tools` identified critical bugs blocking distribution: async/await bugs in request handlers cause race conditions, missing tsconfig files break TypeScript compilation, workspace protocol mismatches prevent dependency resolution, and governance enforcement crashes MCP servers instead of returning errors. These must be fixed before WP07 (desktop provisioning) can proceed.

**Target repo**: `zivtech-mcp-tools` (separate from joyus-desktop)
**Packages**: axe-core, lighthouse, readability, screenshot, eval-runner, shared, plus shell stubs (cms-api, coverage, drupal-api, pubmed, session-bridge)

## Subtasks

### T031: Fix async/await bug in all MCP server executors (CRITICAL-1)

**Purpose**: MCP server request handlers are not properly awaiting async operations, causing race conditions and undefined results.

**Steps**:
1. Audit all MCP server packages for async handler functions:
   - `packages/axe-core/src/index.ts`
   - `packages/lighthouse/src/index.ts`
   - `packages/readability/src/index.ts`
   - `packages/screenshot/src/index.ts`
   - `packages/eval-runner/src/index.ts`
2. For each handler, check:
   - Is the handler function marked `async`?
   - Are all internal async calls properly `await`ed?
   - Are Promises returned without awaiting?
   - Are there callback-style patterns that should be promisified?
3. Fix each issue:
   - Add missing `await` keywords
   - Mark handlers as `async` if they perform async work
   - Convert callback patterns to async/await where appropriate
4. Verify by running each MCP server locally and making test tool calls.

**Files**: All `packages/*/src/index.ts` files (or wherever handlers are defined)

**Validation**: All MCP servers respond to tool calls without race conditions. No `Promise { <pending> }` in responses. Each server tested with at least one tool call.

---

### T032: Add per-package tsconfig.json files (CRITICAL-2)

**Purpose**: Packages are missing individual tsconfig.json files, causing TypeScript compilation failures.

**Steps**:
1. Check which packages lack `tsconfig.json`:
   ```bash
   for dir in packages/*/; do [ -f "$dir/tsconfig.json" ] || echo "Missing: $dir"; done
   ```
2. Create `tsconfig.json` in each package that lacks one:
   ```json
   {
     "extends": "../../tsconfig.base.json",
     "compilerOptions": {
       "outDir": "./dist",
       "rootDir": "./src"
     },
     "include": ["src/**/*"]
   }
   ```
3. If root `tsconfig.base.json` doesn't exist, create one with shared compiler options:
   ```json
   {
     "compilerOptions": {
       "target": "ES2022",
       "module": "NodeNext",
       "moduleResolution": "NodeNext",
       "strict": true,
       "esModuleInterop": true,
       "declaration": true,
       "declarationMap": true,
       "sourceMap": true
     }
   }
   ```
4. Add `references` in root `tsconfig.json` for project references build if using composite mode.
5. Verify: `npx tsc --build` passes at root level.

**Files**: `packages/*/tsconfig.json`, root `tsconfig.base.json`

**Validation**: `npm run typecheck` (or `npx tsc --noEmit`) passes at root. Each package compiles independently.

---

### T033: Fix workspace protocol to match package manager (MAJOR-1)

**Purpose**: Cross-package dependencies use wrong workspace protocol, breaking installation.

**Steps**:
1. Determine the intended package manager:
   - Check for `pnpm-workspace.yaml` (pnpm), `package-lock.json` (npm), `yarn.lock` (yarn)
   - Check `.npmrc` for configuration hints
   - Check root `package.json` for `packageManager` field
2. Audit all `package.json` files for workspace references:
   ```bash
   grep -r "workspace:" packages/*/package.json
   ```
3. Fix protocol to match:
   - **npm workspaces**: Use `"*"` with `workspaces` field in root package.json, or `"file:../shared"`
   - **pnpm**: Use `"workspace:*"` or `"workspace:^"`
   - **yarn**: Use `"workspace:*"` or `"*"` with `workspaces`
4. Delete the lockfile and regenerate: `rm package-lock.json && npm install` (adjust for package manager).
5. Verify all cross-package imports resolve at runtime.

**Files**: `packages/*/package.json`, root lockfile

**Validation**: `npm install` (or equivalent) completes without errors. Cross-package imports work. No "cannot find module" errors at runtime.

---

### T034: Move governance enforcement inside try/catch (MAJOR-6)

**Purpose**: Governance check failures crash the MCP server instead of returning graceful errors.

**Steps**:
1. Find governance enforcement calls — likely in `packages/shared/src/governance.ts` or in per-package request handlers.
2. Identify the crash pattern: unhandled exception from governance check propagates up and kills the server process.
3. Wrap governance checks in try/catch:
   ```typescript
   try {
     const decision = await checkGovernance(toolName, context);
     if (decision === 'deny') {
       return { error: { code: -32600, message: `Tool "${toolName}" blocked by policy` } };
     }
   } catch (err) {
     // Governance check itself failed (bug, not policy)
     console.error('Governance check error:', err);
     // In audit mode: proceed. In enforce mode: deny (fail-closed).
     if (mode === 'enforce') {
       return { error: { code: -32600, message: 'Governance check unavailable, tool blocked (fail-closed)' } };
     }
   }
   ```
4. Distinguish between:
   - **Tool blocked** (policy decision, expected): Return MCP error with clear message
   - **Governance check failed** (bug, unexpected): Log error, apply fail-closed in enforce mode
5. Ensure the MCP server process stays running after any governance outcome.

**Files**: `packages/shared/src/governance.ts`, per-package handlers that call governance

**Validation**: Blocked tool returns error response (server stays running). Governance check crash doesn't kill the MCP server. Fail-closed works in enforce mode.

---

### T035: Fix or exclude shell packages from build (MAJOR-5)

**Purpose**: Shell/stub packages fail to build because they're incomplete implementations.

**Steps**:
1. Identify shell stubs: `cms-api`, `coverage`, `drupal-api`, `pubmed`, `session-bridge`.
2. Check each: is there any real implementation, or are they pure stubs?
3. For each stub, choose one approach:
   - **Option A**: Add minimal no-op implementation that builds:
     ```typescript
     // Stub implementation - not yet functional
     export function handler() {
       return { error: { code: -32601, message: 'Not implemented' } };
     }
     ```
   - **Option B**: Exclude from build scripts:
     ```json
     // root package.json scripts
     "build": "turbo run build --filter='!cms-api' --filter='!coverage' ..."
     ```
4. If excluding: update root workspace config and build scripts.
5. Document which packages are stubs and their planned timeline.

**Files**: `packages/cms-api/`, `packages/coverage/`, `packages/drupal-api/`, `packages/pubmed/`, `packages/session-bridge/`, root `package.json` build scripts

**Validation**: `npm run build` passes at root. Stub packages either build cleanly (no-op) or are excluded without breaking other packages.

---

### T036: Wire telemetry config values through collector (MAJOR-2, MAJOR-3)

**Purpose**: Telemetry configuration exists but isn't actually read by the collector — events go nowhere.

**Steps**:
1. Find telemetry config definition in `@zivtech-mcp/shared`:
   - Look for environment variable definitions (TELEMETRY_ENDPOINT, TELEMETRY_API_KEY, TELEMETRY_ENABLED)
   - Look for config file loading
2. Find the telemetry collector/emitter code:
   - Where events are constructed and sent
   - Check if it has hardcoded values or reads config
3. Wire the config into the collector:
   ```typescript
   const config = {
     endpoint: process.env.TELEMETRY_ENDPOINT || defaultEndpoint,
     apiKey: process.env.TELEMETRY_API_KEY || '',
     enabled: process.env.TELEMETRY_ENABLED !== 'false',
   };
   ```
4. Ensure the collector uses these values for every event emission.
5. Test: set `TELEMETRY_ENDPOINT=http://localhost:3000/test` → verify events arrive there.

**Files**: `packages/shared/src/telemetry.ts` (or equivalent)

**Validation**: Telemetry events sent to configured endpoint. Changing endpoint config changes where events go. `TELEMETRY_ENABLED=false` stops all event emission.

---

### T037: Align documentation defaults with code defaults (MINOR-3)

**Purpose**: README and docs say one thing, code does another — confusing for users.

**Steps**:
1. Audit `README.md` and per-package READMEs against actual code:
   - Default ports, URLs, timeouts
   - Default configuration values
   - Installation prerequisites
   - Example commands
2. List all discrepancies.
3. Fix docs to match code (prefer fixing docs unless code default is clearly wrong):
   - Update default values in documentation
   - Update example configurations
   - Update installation instructions
4. Add a note in the contributing guide about keeping docs in sync.

**Files**: Root `README.md`, `packages/*/README.md`, relevant source files

**Validation**: Documentation accurately reflects code behavior. All example commands work as documented.

---

### T038: Verify npm run build and npm run typecheck pass at root

**Purpose**: Final clean-build verification that all fixes work together.

**Steps**:
1. Clean all build artifacts: `rm -rf packages/*/dist`
2. Run `npm install` (or equivalent) from root — verify clean install.
3. Run `npm run build` at root — verify exit code 0:
   - Fix any remaining compilation errors
   - Document any warnings that are acceptable
4. Run `npm run typecheck` at root — verify exit code 0:
   - Fix any remaining type errors
5. Start each functional MCP server individually — verify it starts without errors:
   ```bash
   for pkg in axe-core lighthouse readability screenshot eval-runner; do
     node packages/$pkg/dist/index.js &
     sleep 2 && kill %1
   done
   ```
6. Run any existing tests: `npm test` (if tests exist).

**Validation**: `npm run build` exits 0. `npm run typecheck` exits 0. All functional MCP servers start without errors. No type errors, no missing module errors.

### T066: Verify or add test coverage for all fixed code (Constitution 2.5)

**Purpose**: Ensure fixes are covered by tests per constitution mandate (2.5 Full Coverage Gates — 100% coverage mandatory).

**Steps**:
1. Check existing test infrastructure: `npm test` at repo root.
2. For each fix (T031-T037), verify test coverage exists:
   - T031 (async/await): Test that each MCP handler returns resolved values (not pending promises)
   - T034 (governance try/catch): Test that governance failure returns error response, not process crash
   - T036 (telemetry wiring): Test that config values flow to collector, disabled flag stops emission
3. Add missing tests for any fix without coverage.
4. Run coverage report: `npm test -- --coverage`
5. Target: 100% on all modified files. If existing uncovered code makes 100% infeasible for entire repo, achieve 100% on files touched by T031-T037.

**Files**: `packages/*/src/__tests__/`, coverage config

**Validation**: Coverage report shows 100% on modified files. All fixes have corresponding test assertions.

---

## Implementation Notes

- **This WP works on `zivtech-mcp-tools` repo**, NOT joyus-desktop. The implementer needs access to that repo.
- **Priority order**: T031 (async/await) and T032 (tsconfig) first — they unblock everything else.
- **Shell stubs (T035)**: Quick fix — either `"build": "echo 'stub'"` or exclude from workspace build.
- **Workspace protocol (T033)**: Check for `.npmrc` or `pnpm-workspace.yaml` to determine the intended package manager.
- **Branch strategy**: Create a fix branch in `zivtech-mcp-tools`, fix all issues, merge before WP07 starts.

## Done Criteria

- [ ] All async/await bugs fixed in MCP server handlers (T031)
- [ ] Per-package tsconfig.json files present and correct (T032)
- [ ] Workspace protocol matches package manager (T033)
- [ ] Governance enforcement errors caught gracefully (T034)
- [ ] Shell packages build or are excluded cleanly (T035)
- [ ] Telemetry config properly wired to collector (T036)
- [ ] Documentation matches code defaults (T037)
- [ ] `npm run build` and `npm run typecheck` pass at root (T038)
- [ ] 100% test coverage on modified files (T066) — constitution 2.5 mandatory

## Risks & Edge Cases

- **Behavior changes**: Fixing async/await may change behavior of existing (broken) implementations — test thoroughly
- **Hidden type errors**: tsconfig changes may surface new type errors — fix them as they appear
- **Lockfile regeneration**: Workspace protocol fix requires new lockfile — ensure CI uses the new one
- **Stub dependents**: Verify no functional package depends on a stub package
- **Separate repo coordination**: Changes here must be merged before WP07 starts in joyus-desktop

## Implementation Command

```bash
spec-kitty implement WP06
```

## Activity Log

- 2026-03-10: Prompt generated in planned lane.
- 2026-03-12T02:11:37Z – claude-opus – shell_pid=97697 – lane=doing – Started implementation via workflow command
- 2026-03-12T11:17:34Z – claude-opus – shell_pid=97697 – lane=for_review – mcp-tools-compat package: 30 tests, 100% coverage
- 2026-03-12T11:35:18Z – claude-opus – shell_pid=79561 – lane=doing – Started review via workflow command
