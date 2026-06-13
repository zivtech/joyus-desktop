# Plan 001: Register Production Sidecar IPC Methods

## Summary

Production sidecar startup registers only part of the sidecar IPC surface. The missing method families are implemented and tested in isolation, and the Rust/UI layers already call them, but `startSidecar` does not wire them into the running process. This makes important desktop UI paths depend on methods that can return `method not found` in production.

This is not a cosmetic gap. The architecture decision was never fully interrogated end to end: implementation, Rust command proxy, UI consumer, and lifecycle test all exist, but the production registration path is incomplete.

Harsh-critic revision note: execute Plan 000 first. Also do not implement the sync IPC portion until the sync adapter design below is made explicit. The original plan correctly found the IPC gap, but it under-specified sync state ownership.

## Priority

- Priority: P1
- Risk: High
- Effort: Medium to High
- Dependencies: None

## What This Is Not Claiming

- This plan is not claiming every missing method should be eagerly enabled without checking runtime dependencies.
- This plan is not claiming sync trigger semantics are already obvious. `sync.trigger` has the highest uncertainty because it needs real production config/dependency wiring.
- This plan is not claiming the session-specific registration path is broken; session methods are registered separately and should keep their current behavior.

## Evidence

Production startup:

- `apps/desktop-companion/src/sidecar/main.ts:58-62` creates the IPC and services, then calls `registerAllMethods(ipc, services, startTime, deps.nowFn)`.
- `apps/desktop-companion/src/sidecar/main.ts:109-114` registers session methods asynchronously, but only session methods.
- `apps/desktop-companion/src/sidecar/services.ts:178-195` defines `registerAllMethods`, but it registers only health, usage, onboarding, recon, credential, and GitHub auth methods.
- `apps/desktop-companion/src/sidecar/services.ts:187` calls `registerReconMethods(ipc)` without sync deps, so recon sync-version gating can fail open in production.

Implemented method families not wired by production startup:

- `apps/desktop-companion/src/sidecar/services.ts:211-231` implements server methods: `servers.list`, `servers.start`, `servers.stop`, `servers.restart`.
- `apps/desktop-companion/src/sidecar/services.ts:233-266` implements server notifications.
- `apps/desktop-companion/src/sidecar/services.ts:268-290` implements Chrome, Claude, and skill-file detection.
- `apps/desktop-companion/src/sidecar/services.ts:308-349` implements sync and skills methods: `sync.trigger`, `sync.status`, `skills.list`.
- `apps/desktop-companion/src/sidecar/services.ts:362-385` implements governance methods: `governance.getMode`, `governance.getDecisions`.

Rust command proxies expect those methods:

- `apps/desktop-companion/src-tauri/src/commands.rs:7-25` proxies server commands to `servers.*`.
- `apps/desktop-companion/src-tauri/src/commands.rs:27-40` proxies sync/skills commands to `sync.*` and `skills.list`.
- `apps/desktop-companion/src-tauri/src/commands.rs:42-50` proxies governance commands to `governance.*`.
- `apps/desktop-companion/src-tauri/src/commands.rs:67-70` proxies Chrome detection to `chrome.detect`.
- `apps/desktop-companion/src-tauri/src/commands.rs:180-190` proxies Claude and skill-file checks to `claude.detect` and `skills.checkFile`.

UI consumers invoke those Rust commands:

- `apps/desktop-companion/src/ui/hooks/useServerStatus.ts:47` invokes `get_servers`.
- `apps/desktop-companion/src/ui/pages/Skills.tsx:19` invokes `get_skills`.
- `apps/desktop-companion/src/ui/pages/Skills.tsx:42` invokes `trigger_sync`.
- `apps/desktop-companion/src/ui/hooks/useSyncStatus.ts:49` invokes `get_sync_status`.
- `apps/desktop-companion/src/ui/hooks/useGovernance.ts:45` invokes `get_governance_mode`.
- `apps/desktop-companion/src/ui/hooks/useGovernance.ts:50` invokes `get_governance_decisions`.

Tests currently mask the production gap:

- `apps/desktop-companion/test/integration/sidecar-lifecycle.test.ts:126-141` says `servers.list` is not registered in the minimal sidecar and accepts either result or error.
- `apps/desktop-companion/test/integration/sidecar-lifecycle.test.ts:144-155` similarly accepts either result or error for `sync.status`.
- `apps/desktop-companion/test/sidecar/usage-onboarding.test.ts:663-680` says `registerAllMethods` registers health, usage, and onboarding only.
- `apps/desktop-companion/test/sidecar/sync-governance.test.ts` and `apps/desktop-companion/test/sidecar/server-management.test.ts` test isolated registration helpers, not the production startup path.

## Implementation Steps

1. Inspect the current service dependency model before editing.
   - Read `apps/desktop-companion/src/sidecar/main.ts`.
   - Read `apps/desktop-companion/src/sidecar/services.ts`.
   - Read the default dependency factories used by Chrome, Claude, skill sync, governance, and recon.
   - Confirm whether `createDefaultChromeDeps`, `createDefaultClaudeDeps`, and managed tooling sync config are already exported from the relevant modules.

2. Add one production registration helper in `apps/desktop-companion/src/sidecar/services.ts`.
   - Suggested name: `registerOperationalMethods`.
   - It should register the method groups that are implemented but currently absent from production startup.
   - Keep `registerAllMethods` stable if many tests rely on its current narrow semantics, or refactor it only if tests are updated to assert the expanded production contract.

3. Wire server management.
   - Call `registerServerMethods(ipc, services.registry)`.
   - Call `registerServerNotifications(ipc, services.processManager, services.registry)`.
   - Preserve existing process-manager ownership and shutdown behavior.

4. Wire local detection methods.
   - Call `registerChromeDetect(ipc, createDefaultChromeDeps())`.
   - Call `registerClaudeDetect(ipc, createDefaultClaudeDeps())`.
   - Call `registerSkillFileCheck(ipc, { fileExists: existsSync, homedir })` or the existing equivalent default dependency shape.
   - Keep these methods side-effect-light. Detection should not install or mutate tools.

5. Wire governance methods.
   - Call `registerGovernanceMethods(ipc, services, decisionLog)`.
   - If there is not yet a production decision log source, start with an explicit empty in-memory log and document that as current behavior in code or tests.
   - Do not invent persistence in this plan.

6. Wire sync methods carefully.
   - First write the adapter design in this plan or in source comments/tests.
   - Define the source of current version, pinned/target version, `bundleName`, expanded destination path, trigger lifecycle, and error behavior.
   - Identify the real production source for `SyncIpcDeps`: repo URL, target version, destination directory, cache directory, scanner, and status.
   - Prefer the existing managed tooling configuration if it already carries those values.
   - Thread an optional `syncIpcDeps` through `SidecarDeps` for tests if needed.
   - Register `sync.status`, `sync.trigger`, and `skills.list` only once.
   - Pass compatible sync deps into `registerReconMethods` so `recon.create` performs the intended version check.

7. Update `startSidecar` in `apps/desktop-companion/src/sidecar/main.ts`.
   - Call the new production helper after base method registration and before the ready notification.
   - Keep async session registration behavior unchanged unless a test demonstrates ordering is wrong.

8. Tighten lifecycle tests.
   - Replace permissive "result or error" assertions with explicit no-`method not found` assertions.
   - At minimum cover `servers.list`, `sync.status`, `skills.checkFile`, `chrome.detect`, `governance.getMode`, and one recon path that observes sync-version gating.
   - Update or add tests near:
     - `apps/desktop-companion/test/integration/sidecar-lifecycle.test.ts`
     - `apps/desktop-companion/test/sidecar/main.test.ts`
     - `apps/desktop-companion/test/sidecar/mainConfigCheckWiring.test.ts`
     - `apps/desktop-companion/test/sidecar/mainSessionWiring.test.ts`

## STOP Conditions

Stop and surface the issue instead of guessing if:

- No existing production source can be found for sync repo/version/destination/cache configuration.
- The current code cannot expose current/pinned version without duplicating private state inside `createConfigChangeHandler`.
- Registering sync methods would require choosing a new on-disk location or network policy.
- A method name collision appears after wiring the method families into startup.
- Any method requires credentials or secrets that are not already modeled through environment/config.

## Acceptance Criteria

- Production sidecar startup registers the method families consumed by Rust command proxies and UI hooks.
- `servers.list` and `sync.status` are no longer allowed to pass lifecycle tests through `method not found`.
- `registerReconMethods` receives sync deps in production or an explicit, tested fallback that does not silently skip required version checks.
- Session method registration remains asynchronous and existing session tests still pass.
- No secrets or hardcoded credentials are introduced.

## Verification

Run targeted tests first:

```bash
pnpm vitest run apps/desktop-companion/test/sidecar/main.test.ts apps/desktop-companion/test/sidecar/mainConfigCheckWiring.test.ts apps/desktop-companion/test/sidecar/mainSessionWiring.test.ts apps/desktop-companion/test/integration/sidecar-lifecycle.test.ts apps/desktop-companion/test/sidecar/server-management.test.ts apps/desktop-companion/test/sidecar/sync-governance.test.ts
```

Then run the repo gates:

```bash
pnpm typecheck
pnpm test
pnpm coverage
```

If Plan 004 has already landed, also run:

```bash
pnpm test:integration
pnpm run ci
```

## Adversarial Self-Check

The weakest part of this plan is sync wiring. A skeptic should challenge whether `sync.trigger` has enough production configuration to be registered honestly. Do not paper over that gap. Either wire it from existing managed tooling config with tests, or stop with a narrow follow-up decision request.
