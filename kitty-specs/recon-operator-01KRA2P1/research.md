# Research: Recon Operator

**Mission**: `recon-operator-01KRA2P1`
**Date**: 2026-05-10

## Decision 1: Command Routing — Sidecar IPC vs. Direct Rust

**Decision**: Short-lived Recon operations (create engagement, scan, export, credential CRUD) use sidecar TypeScript IPC handlers. Only the long-running engagement launch uses a direct Rust `tokio::process::Command`.

**Rationale**: The existing codebase routes all commands through the sidecar IPC layer (`registerMethod` pattern in `services.ts`). The sidecar has a 30-second timeout, which is fine for sub-second operations but fatal for Recon launches (10–60 minutes). Consistency with existing code outweighs the marginal performance benefit of Rust for short operations.

**Alternatives considered**:
- All Rust commands: faster, but fragments the codebase into two routing patterns for the same feature
- All sidecar: impossible for long-running operations due to 30s timeout
- Sidecar with extended timeout: would require framework changes across all other handlers

**Exception**: Phase 2 Keychain operations (`keyring-rs`) are inherently Rust (crate is Rust-only) and register as direct Tauri commands. This is a technology constraint, not a design choice.

## Decision 2: Credential Injection Model

**Decision**: Phase 1 reads credentials from a flat file at `~/Library/Application Support/com.joyus.desktop-companion/credentials.env` (0600 permissions, atomic write). Phase 2 migrates to macOS Keychain via `keyring-rs`. In both phases, credentials are injected into the child process as environment variables (`Command::env("KEY", value)` in Rust), never written to the engagement directory.

**Rationale**: The flat file matches Claude Code's own API key storage pattern (acceptable for single-user dogfood). Keychain is the production target but requires `keyring-rs` integration and has UX issues without code signing (per-launch "Allow" prompts). Phasing lets the operator start using the feature 2 weeks earlier.

**Alternatives considered**:
- Keychain from day one: adds 3–5 days to Phase 1, pushes first demo to week 3
- Encrypted SQLite via `tauri-plugin-sql`: requires passphrase on every launch, worse UX for a non-technical operator
- Environment variable passthrough from Desktop process: doesn't persist across restarts

## Decision 3: Completion Detection Strategy

**Decision**: Primary signal is child process exit (exit code 0 = success, non-zero = error). Backup signal is a `.recon-complete` JSON sentinel file written by the analysis skill. Desktop treats the sentinel as optional metadata (file list, phase count), not as the completion trigger.

**Rationale**: Process exit is deterministic and reliable. The sentinel depends on LLM instruction-following, which is not guaranteed. Making process exit primary and sentinel secondary means Desktop works correctly even if the sentinel is never written.

**Alternatives considered**:
- Sentinel as primary signal (polling): fragile — LLM may not write it on error paths
- MCP callback from analysis tool to Desktop: introduces circular dependency, high complexity
- Manual "Mark Complete" button: high user-error risk

## Decision 4: Frontend Architecture

**Decision**: Add new pages (`ReconSetup.tsx`, `ReconDashboard.tsx`) following existing conventions: inline style objects, `useState`/`useEffect` state management, `safeInvoke`/`safeListen` IPC pattern, sub-components defined in the same file, `MemoryRouter` routes nested under `<Layout>`.

**Rationale**: The existing Desktop frontend uses zero external CSS tooling or state management libraries. All pages follow the same pattern (Sites.tsx, Servers.tsx, etc.). Introducing new patterns for one feature would create maintenance burden.

**Alternatives considered**:
- CSS modules or Tailwind: not used anywhere in the codebase, would require build config changes
- Redux/Zustand for state: overkill for 2 pages with local state, no shared state across routes
- Separate app for Recon: unnecessary complexity, operator needs one app

## Decision 5: Scan Script Distribution

**Decision**: Phase 1 bundles `scan-sensitive-output.mjs` as a Tauri resource (added to `tauri.conf.json` `bundle.resources`). The sidecar invokes it via the bundled Node binary (`binaries/node`). Phase 2 includes the scan script in the skill-sync `recon-operator-bundle` to keep versions in lockstep.

**Rationale**: The script is already portable (verified: accepts CLI args, resolves paths via `path.resolve`). The Desktop already bundles Node (`externalBin: ["binaries/node"]`), so running the script is trivial. Bundling in resources keeps it versioned with the Desktop build.

**Alternatives considered**:
- Inline scan logic in sidecar TypeScript: duplicates regex patterns, harder to keep in sync with joyus-recon
- Download scan script at runtime: adds network dependency, complicates offline use
- Skip scan, trust operator: unacceptable — credential leakage is the primary safety concern

## Codebase Reference

### Sidecar IPC Pattern
- Handler modules: `apps/desktop-companion/src/sidecar/*.ts`
- Registration: `registerXxxMethods(ipc: IpcHandler, ...deps)` function per module
- Orchestrator: `registerAllMethods()` in `services.ts` calls all registration functions
- IPC handler type: `(params: unknown) => Promise<unknown>`

### Rust Command Pattern
- Commands: `apps/desktop-companion/src-tauri/src/commands.rs`
- Most commands proxy to sidecar: `state.send_request("method", params).await`
- Direct commands (no sidecar): take `AppHandle` instead of `State<SidecarState>`
- Registration: `tauri::generate_handler![...]` in `main.rs`

### Frontend IPC Pattern
- `safeInvoke<T>(cmd, args?)` — lazy-imports `@tauri-apps/api/core`, returns `T | undefined`
- `safeListen<T>(event, handler)` — lazy-imports `@tauri-apps/api/event`, returns unlisten function
- Both defined locally per page (not a shared util)
- Hook: `useTauriEvent<T>(eventName)` in `src/ui/hooks/useTauriEvent.ts`

### Tauri Bundle Config
- Identifier: `com.joyus.desktop-companion`
- Resources: `["binaries/sidecar-main.mjs"]` (add scan script here)
- External bin: `["binaries/node"]` (Node binary for sidecar + scan script)
- macOS minimum: 10.15

### Router
- `MemoryRouter` (no real URL routing in Tauri)
- All main pages nested under `<Layout>` (sidebar nav)
- Onboarding is full-screen, outside Layout
- Add route: import page in `App.tsx`, add `<Route path="/recon" element={<Recon />} />`
