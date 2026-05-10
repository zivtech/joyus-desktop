---
work_package_id: WP02
title: Sidecar Credential Handlers
dependencies:
- WP01
requirement_refs:
- FR-008
- FR-009
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
- date: '2026-05-10'
  event: created
  note: Generated via /spec-kitty.tasks
authoritative_surface: apps/desktop-companion/src/sidecar/credentials.ts
execution_mode: code_change
mission_id: 01KRA2P11PNXGNMMJQYQYP34M8
owned_files:
- apps/desktop-companion/src/sidecar/credentials.ts
- apps/desktop-companion/src/sidecar/services.ts
tags: []
wp_code: WP02
---

# WP02: Sidecar Credential Handlers

## Overview

Create the Node.js sidecar IPC handlers for operator credential management. Credentials are stored in a flat `.env`-style file in the app's data directory. This WP also wires both the recon and credential handler modules into the central `services.ts` registration function.

## Codebase Pattern

Same handler module pattern as WP01. See `chrome-detect.ts` / `usage-collector.ts` for reference. All handlers registered via `registerAllMethods()` in `services.ts`.

## Credential File

- **Path**: `~/Library/Application Support/com.joyus.desktop-companion/credentials.env`
- **Format**: `KEY=value` lines (dotenv-style, no quoting required for simple values)
- **Allowlist** (only these keys may be read or written):
  - `DATAFORSEO_LOGIN`
  - `DATAFORSEO_PASSWORD`
  - `CRUX_API_KEY`
  - `ANTHROPIC_API_KEY`
  - `PAGESPEED_API_KEY`

## Subtasks

### T006 — Create `credentials.ts` scaffold

Create `apps/desktop-companion/src/sidecar/credentials.ts`.

- Export `registerCredentialMethods(ipc: IpcHandler)`.
- Define the credential file path constant: `~/Library/Application Support/com.joyus.desktop-companion/credentials.env` (resolve `~` using `os.homedir()`).
- Define the allowlist as a `readonly string[]` constant at module scope.
- No methods yet — scaffold only. File must compile without errors.

### T007 — Implement `credentials.save`

Register method `credentials.save` inside `registerCredentialMethods`.

**Input**: `{ key: string, value: string }`

**Behavior**:
1. Reject if `key` is not in the allowlist (return a descriptive error, do not write).
2. Read the existing credentials file if it exists (parse into `Map<string, string>`). If absent, start with an empty map.
3. Update or add the key-value pair in the map.
4. Serialize back to `KEY=value` line format (one per line, trailing newline).
5. **Atomic write**: write to `{credentialsFilePath}.tmp`, then `fs.promises.rename` to the final path.
6. Set file permissions to `0o600` via `fs.promises.chmod` after rename.
7. Create the parent directory if it does not exist (`mkdir -p` equivalent).
8. Return `{ saved: true, key }`.

**Security**: Never log or return the value. Validate that the key is in the allowlist before any file I/O.

### T008 — Implement `credentials.list`

Register method `credentials.list` inside `registerCredentialMethods`.

**Input**: `{}` (no parameters)

**Behavior**:
1. Read and parse the credentials file (if absent, treat as empty).
2. For each key in the allowlist, check whether it is present and non-empty in the file.
3. Return `Array<{ key: string, isSet: boolean }>` — one entry per allowlist key, in allowlist order.
4. **NEVER return credential values** — `isSet` is a boolean only.

### T009 — Implement `credentials.verify`

Register method `credentials.verify` inside `registerCredentialMethods`.

**Input**: `{}` (no parameters)

**Behavior**:
1. Read credentials file. Collect only the configured (isSet) credentials.
2. For each configured credential, perform a live verification request (10-second timeout):

   **ANTHROPIC_API_KEY**:
   - `GET https://api.anthropic.com/v1/models`
   - Header: `x-api-key: {ANTHROPIC_API_KEY}`, `anthropic-version: 2023-06-01`
   - Valid if HTTP 200.

   **DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD** (verify as a pair):
   - `GET https://api.dataforseo.com/v3/appendix/user_data`
   - Authorization: `Basic base64({DATAFORSEO_LOGIN}:{DATAFORSEO_PASSWORD})`
   - Valid if HTTP 200.

   **CRUX_API_KEY**, **PAGESPEED_API_KEY**:
   - No live verification defined for MVP. Return `{ key, valid: null, error: "verification not implemented" }`.

3. Run all verifications in parallel (`Promise.allSettled`).
4. Return `Array<{ key: string, valid: boolean | null, error?: string }>`.

**Error handling**: Network errors, timeouts, and non-200 responses all produce `{ valid: false, error: <message> }`. Never throw — always return a result object.

### T010 — Register both handler modules in `services.ts`

Wire both new handler modules into the central registration function.

1. Open `apps/desktop-companion/src/sidecar/services.ts`.
2. Import `registerReconMethods` from `./recon.ts`.
3. Import `registerCredentialMethods` from `./credentials.ts`.
4. Call both inside `registerAllMethods()` alongside existing registrations.
5. Maintain the existing call order for previously registered handlers; append the new ones at the end.

## Success Criteria

- `credentials.save` persists a credential value to disk. After process restart, `credentials.list` shows `isSet: true` for that key.
- Credentials file has permissions `0o600` after a save.
- `credentials.save` rejects a key not in the allowlist without writing to disk.
- `credentials.list` never returns values — only `isSet` booleans.
- `credentials.verify` returns `{ valid: false }` for a deliberately incorrect ANTHROPIC_API_KEY.
- `credentials.verify` returns `{ valid: true }` for a valid ANTHROPIC_API_KEY (tested manually; not in CI to avoid API calls).
- Both `registerReconMethods` and `registerCredentialMethods` are called from `registerAllMethods()` in `services.ts`.
- TypeScript compiles without errors.
