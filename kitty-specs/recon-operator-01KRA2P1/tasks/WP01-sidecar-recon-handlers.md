---
work_package_id: WP01
title: Sidecar Recon Handlers
dependencies: []
requirement_refs:
- FR-001
- FR-006
- FR-007
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts for this feature were generated on main. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into main unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-recon-operator-01KRA2P1
base_commit: 04554fc9ea8a87df8f0060bd25170f25b0e6794d
created_at: '2026-05-10T23:49:55.861238+00:00'
subtasks:
- T001
- T002
- T003
- T004
- T005
shell_pid: "33921"
agent: "claude:sonnet:implementer:implementer"
history:
- date: '2026-05-10'
  event: created
  note: Generated via /spec-kitty.tasks
authoritative_surface: apps/desktop-companion/src/sidecar/recon.ts
execution_mode: code_change
mission_id: 01KRA2P11PNXGNMMJQYQYP34M8
owned_files:
- apps/desktop-companion/src/sidecar/recon.ts
- apps/desktop-companion/resources/scan-sensitive-output.mjs
- apps/desktop-companion/src-tauri/tauri.conf.json
tags: []
wp_code: WP01
---

# WP01: Sidecar Recon Handlers

## Overview

Create the Node.js sidecar IPC handlers that manage engagement lifecycle (create, scan, export) for the Recon Operator feature. These handlers run in the sidecar process and are called by the Rust layer via IPC.

## Codebase Pattern

Handler modules live in `apps/desktop-companion/src/sidecar/*.ts`. Each exports a `registerXxxMethods(ipc: IpcHandler, ...deps)` function. All methods are registered from `registerAllMethods()` in `services.ts`. IPC handler signature: `(params: unknown) => Promise<unknown>`.

Reference implementations: `chrome-detect.ts`, `usage-collector.ts`.

## Subtasks

### T001 — Create `recon.ts` scaffold

Create `apps/desktop-companion/src/sidecar/recon.ts`.

- Export `registerReconMethods(ipc: IpcHandler)`.
- Follow the structure of `chrome-detect.ts` / `usage-collector.ts`: import `IpcHandler`, define a registration function, register individual method handlers inside it.
- No methods yet — scaffold only. File must compile without errors.

### T002 — Implement `recon.create` handler

Register method `recon.create` inside `registerReconMethods`.

**Input** (params): `{ clientName: string, url: string, accessMode: string }`

**Behavior**:
1. Slugify `clientName` (lowercase, replace non-alphanumeric runs with `-`, strip leading/trailing `-`).
2. Generate an `engagementId` (e.g., `slug-YYYYMMDD-HHMMSS` or similar deterministic format).
3. Create the engagement directory: `~/Documents/joyus-recon-engagements/{client-slug}/` (use `os.homedir()`; `mkdir -p` equivalent via `fs.promises.mkdir` with `recursive: true`).
4. Write `.recon-meta.json` to the engagement directory with fields: `clientName`, `clientSlug`, `url`, `accessMode`, `engagementId`, `createdAt` (ISO-8601).
5. Return `{ engagementDir: string, engagementId: string, clientSlug: string }`.

**Error handling**: If directory creation or file write fails, reject with a descriptive error message.

### T003 — Implement `recon.scan` handler

Register method `recon.scan` inside `registerReconMethods`.

**Input**: `{ engagementDir: string }`

**Behavior**:
1. Resolve the bundled `scan-sensitive-output.mjs` script. Use Tauri's resource path resolution: the file is bundled as a resource and available at a known path relative to the app resource dir. Fall back to resolving relative to `__dirname` for development.
2. Spawn `node scan-sensitive-output.mjs {engagementDir}` as a child process.
3. Parse **stderr** for findings. Expected line format: `file:line pattern` (one finding per line).
4. Collect all stderr lines, parse each into `{ file: string, line: number, pattern: string }`.
5. Return `{ passed: boolean, findings: Array<{ file: string, line: number, pattern: string }> }`.
   - `passed: true` when `findings` is empty.
   - `passed: false` when one or more findings are present.

**Error handling**: If the script cannot be found or node spawn fails, reject with a clear error. Non-zero exit code from the script means findings were detected (treat as `passed: false`, not an error).

### T004 — Implement `recon.export` handler

Register method `recon.export` inside `registerReconMethods`.

**Input**: `{ engagementDir: string, overrideScan?: boolean }`

**Behavior**:
1. Run `recon.scan` logic internally (call the scan implementation directly, not via IPC).
2. If scan fails (`passed: false`) and `overrideScan` is falsy: return `{ blocked: true, findings }` immediately — do not create a zip.
3. If scan passes OR `overrideScan` is true:
   a. If `overrideScan` is true and scan failed: write `{engagementDir}/.scan-overrides.json` with `{ overriddenAt: ISO-8601, findings }`.
   b. Create a zip archive of the engagement directory, **excluding**: `.env`, `.recon-complete`, `.recon-meta.json`, `.scan-overrides.json`, `node_modules/`, `.git/`, files matching `credentials*`.
   c. Write the zip adjacent to the engagement directory or inside a `exports/` subdirectory (implementer's choice, must be deterministic and documented in code comments).
   d. Return `{ zipPath: string, size: number, scanPassed: boolean, overridden?: boolean }`.

**Zip implementation**: Use the `archiver` npm package (already used elsewhere in the sidecar, or add as dependency) or Node's built-in `zlib` streams with `tar`. Do not shell out to `zip`.

### T005 — Bundle `scan-sensitive-output.mjs` and update `tauri.conf.json`

1. Copy `scan-sensitive-output.mjs` from the joyus-recon repo (located at `~/.claude/skills/scan-sensitive-output.mjs` or the joyus-recon project directory) to `apps/desktop-companion/resources/scan-sensitive-output.mjs`.
2. Update `apps/desktop-companion/src-tauri/tauri.conf.json` resources array:
   ```json
   "resources": [
     "binaries/sidecar-main.mjs",
     "resources/scan-sensitive-output.mjs"
   ]
   ```
3. Confirm the script exists and is executable. Add a comment in `recon.ts` documenting how the resource path is resolved at runtime vs. development.

## Success Criteria

- `recon.create` produces a valid directory at `~/Documents/joyus-recon-engagements/{slug}/` with a parseable `.recon-meta.json`.
- `recon.scan` detects a test credential string (e.g., `ANTHROPIC_API_KEY=sk-ant-test`) placed in a file inside a temp engagement dir.
- `recon.export` creates a zip that, when extracted, does not contain `.env` or `credentials*` files. With `overrideScan: false` and a flagged file present, returns `{ blocked: true }`.
- All three handlers are registered and callable via IPC.
- `scan-sensitive-output.mjs` is present in `apps/desktop-companion/resources/` and referenced in `tauri.conf.json`.
- TypeScript compiles without errors (`pnpm typecheck` or equivalent passes).

## Activity Log

- 2026-05-10T23:49:56Z – claude:opus:implementer:implementer – shell_pid=79223 – Assigned agent via action command
- 2026-05-10T23:54:48Z – claude:opus:implementer:implementer – shell_pid=79223 – Ready for review: recon.ts with create/scan/export handlers, scan-sensitive-output.mjs bundled as resource, tauri.conf.json updated. TypeScript clean, no external deps added.
- 2026-05-10T23:55:20Z – claude:sonnet:reviewer:reviewer – shell_pid=2300 – Started review via action command
- 2026-05-10T23:59:16Z – claude:sonnet:reviewer:reviewer – shell_pid=2300 – Moved to planned
- 2026-05-10T23:59:44Z – claude:sonnet:implementer:implementer – shell_pid=33921 – Started implementation via action command
