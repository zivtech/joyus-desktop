---
work_package_id: WP02
title: Node.js Sidecar Bootstrap
dependencies: []
subtasks: [T006, T007, T008, T009, T010, T011]
history:
- date: '2026-03-14'
  event: created
  note: Generated from spec-kitty.tasks
authoritative_surface: src/sidecar/
execution_mode: code_change
mission_id: 01KPR4E967F61H0B7K24440QG2
owned_files:
- src/sidecar/ipc-handler.ts
- src/sidecar/main.ts
- src/sidecar/services.ts
wp_code: WP02
---

# WP02 — Node.js Sidecar Bootstrap

**Objective**: Create the Node.js sidecar process that hosts all existing TypeScript business logic, implement the JSON-RPC 2.0 communication protocol over stdio, wire up existing packages as services, and configure the bundling pipeline.

**Implementation command**: `spec-kitty implement WP02 --base WP01`

## Context

The sidecar is a long-running Node.js process that Tauri spawns and manages. It hosts `mcp-registry`, `desktop-sync`, `mcp-governance`, `policy-client`, and `session-agent`. Communication with the Rust backend happens via JSON-RPC 2.0 over stdio (stdin/stdout). The sidecar is bundled into a single JS file via esbuild and shipped alongside a platform-specific Node.js binary.

---

## Subtask T006: Create Sidecar Entry Point

**Purpose**: Bootstrap the sidecar process with stdio JSON-RPC listener.

**Steps**:
1. Create `apps/desktop-companion/src/sidecar/main.ts`:
   - Read JSON-RPC messages from stdin (newline-delimited JSON)
   - Parse each line as a JSON-RPC 2.0 request
   - Dispatch to method handlers via a registry map
   - Write JSON-RPC responses to stdout
   - Log errors to stderr (not stdout — that's the IPC channel)
2. Implement message framing:
   - Each message is a single line of JSON terminated by `\n`
   - Use `readline` interface on `process.stdin`
   - Write responses with `process.stdout.write(JSON.stringify(response) + "\n")`
3. Add graceful shutdown handler:
   - Listen for SIGTERM
   - Stop all services, then exit

**Files**:
- `apps/desktop-companion/src/sidecar/main.ts` (new, ~80 lines)

**Validation**:
- [ ] Sidecar starts and listens on stdin
- [ ] Sending `{"jsonrpc":"2.0","id":1,"method":"health.check","params":{}}` on stdin returns a valid response on stdout
- [ ] SIGTERM triggers graceful shutdown

---

## Subtask T007: Implement JSON-RPC 2.0 Protocol Handler

**Purpose**: Robust protocol handling with proper error codes and notification support.

**Steps**:
1. Create `apps/desktop-companion/src/sidecar/ipc-handler.ts`:
   - Type definitions for JSON-RPC request, response, notification, and error
   - Method registry: `Map<string, (params: unknown) => Promise<unknown>>`
   - `handleRequest(raw: string)`: parse, validate, dispatch, return response
   - Error codes per JSON-RPC spec: -32700 (parse error), -32600 (invalid request), -32601 (method not found), -32602 (invalid params), -32603 (internal error)
2. Add `sendNotification(method: string, params: unknown)`:
   - Writes a JSON-RPC notification (no `id`) to stdout
   - Used by services to push state changes to Rust

**Files**:
- `apps/desktop-companion/src/sidecar/ipc-handler.ts` (new, ~100 lines)

**Validation**:
- [ ] Valid requests return correct responses
- [ ] Invalid JSON returns -32700
- [ ] Unknown methods return -32601
- [ ] Notifications are written without `id` field

---

## Subtask T008: Wire Up Existing Services

**Purpose**: Initialize existing packages as services within the sidecar.

**Steps**:
1. Create `apps/desktop-companion/src/sidecar/services.ts`:
   - Import and initialize `createProcessManager` from `@joyus/mcp-registry`
   - Import and initialize `createRegistry` from `@joyus/mcp-registry`
   - Import sync functions from `@joyus/desktop-sync`
   - Import governance functions from `@joyus/mcp-governance`
   - Export a `ServiceContainer` interface that holds all initialized services
   - `createServices(deps)` factory function that wires everything together
2. All services use dependency injection (existing DI pattern) with real implementations:
   - `spawn`: `child_process.spawn`
   - `readFile`/`writeFile`: `fs.promises`
   - `processExists`: check via `process.kill(pid, 0)`
   - etc.
3. Register IPC method handlers that delegate to services

**Files**:
- `apps/desktop-companion/src/sidecar/services.ts` (new, ~120 lines)

**Validation**:
- [ ] Services initialize without errors
- [ ] ProcessManager and Registry are created and accessible
- [ ] Service container is type-safe with no `any` casts

---

## Subtask T009: Bundle Sidecar with esbuild

**Purpose**: Package the sidecar and all its dependencies into a single JS file for distribution.

**Steps**:
1. Create `apps/desktop-companion/scripts/bundle-sidecar.ts` (or `.mjs`):
   ```javascript
   import { build } from "esbuild";
   await build({
     entryPoints: ["src/sidecar/main.ts"],
     bundle: true,
     platform: "node",
     target: "node24",
     format: "esm",
     outfile: "binaries/sidecar-main.mjs",
     external: [],  // Bundle everything
     banner: { js: "#!/usr/bin/env node" },
   });
   ```
2. Add `"build:sidecar": "node scripts/bundle-sidecar.mjs"` to package.json scripts
3. Ensure the bundle includes all workspace dependencies (`@joyus/*` packages)
4. Verify the bundle runs standalone with Node.js

**Files**:
- `apps/desktop-companion/scripts/bundle-sidecar.mjs` (new, ~25 lines)
- Update `apps/desktop-companion/package.json` (add script)

**Validation**:
- [ ] `pnpm build:sidecar` produces `binaries/sidecar-main.mjs`
- [ ] `node binaries/sidecar-main.mjs` starts the sidecar successfully
- [ ] Bundle size is reasonable (<5 MB)

---

## Subtask T010: Download Platform-Specific Node.js Binaries

**Purpose**: Script to fetch Node.js binaries for each target platform so they can be shipped with the app.

**Steps**:
1. Create `apps/desktop-companion/scripts/download-node.mjs`:
   - Define target triples: `aarch64-apple-darwin`, `x86_64-apple-darwin`, `x86_64-pc-windows-msvc`
   - Download Node.js v24 binaries from official releases (nodejs.org)
   - Extract just the `node` binary from each archive
   - Rename to Tauri sidecar convention: `node-<target_triple>[.exe]`
   - Place in `apps/desktop-companion/binaries/`
2. Add `"download:node": "node scripts/download-node.mjs"` to package.json
3. Add `binaries/node-*` to `.gitignore` (downloaded by CI, not committed)

**Files**:
- `apps/desktop-companion/scripts/download-node.mjs` (new, ~60 lines)
- Update `apps/desktop-companion/package.json` (add script)
- Update `.gitignore`

**Validation**:
- [ ] Script downloads all 3 platform binaries
- [ ] Binaries are named correctly for Tauri sidecar convention
- [ ] Binaries are executable

---

## Subtask T011: Configure Tauri externalBin

**Purpose**: Tell Tauri to bundle the Node.js binary and sidecar script with the application.

**Steps**:
1. Update `tauri.conf.json` to add `bundle.externalBin`:
   ```json
   {
     "bundle": {
       "externalBin": ["binaries/node"]
     }
   }
   ```
2. The sidecar main script (`binaries/sidecar-main.mjs`) is included via Tauri's resource system:
   ```json
   {
     "bundle": {
       "resources": ["binaries/sidecar-main.mjs"]
     }
   }
   ```
3. Tauri automatically selects the correct platform binary based on the target triple suffix

**Files**:
- Update `apps/desktop-companion/src-tauri/tauri.conf.json`

**Validation**:
- [ ] `cargo tauri build --debug` includes Node.js binary in the bundle
- [ ] `cargo tauri build --debug` includes sidecar-main.mjs in resources

---

## Definition of Done

- [ ] Sidecar starts, responds to `health.check`, and shuts down cleanly
- [ ] JSON-RPC protocol handles valid requests, invalid JSON, and unknown methods correctly
- [ ] All existing services initialize without errors
- [ ] esbuild produces a working single-file bundle
- [ ] Node.js download script fetches all platform binaries
- [ ] Tauri config includes sidecar binaries

## Risks

- **esbuild bundling**: Some Node.js native modules may not bundle. Test with all `@joyus/*` packages.
- **Node.js binary size**: ~40 MB per platform. Ensure `.gitignore` prevents accidental commits.
- **Sidecar naming**: Tauri's sidecar naming convention must match exactly or the binary won't be found at runtime.

## Activity Log

- 2026-03-14T21:53:32Z – claude-opus – shell_pid=97983 – lane=doing – Started implementation via workflow command
- 2026-03-14T22:17:48Z – claude-opus – shell_pid=97983 – lane=done – All 6 subtasks complete. JSON-RPC 2.0 handler, service container, esbuild bundle, Node.js download script, Tauri config. 867 tests pass, 100% sidecar coverage.
