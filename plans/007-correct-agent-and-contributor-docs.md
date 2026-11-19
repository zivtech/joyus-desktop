# Plan 007: Agent and contributor docs give the correct CI command and an accurate map of the repo

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat cea62f6..HEAD -- CLAUDE.md AGENTS.md docs/architecture.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none. This plan must land before any other plan in `plans/` numbered 008 or higher is executed.
- **Category**: docs
- **Planned at**: commit `cea62f6`, 2026-11-17

## Why this matters

`CLAUDE.md` and `AGENTS.md` are the first files a coding agent reads in this repo. Both say `pnpm ci` runs the full CI pipeline. On the pinned pnpm (10.5.2), `pnpm ci` is an alias for `clean-install`: it deletes `node_modules` and reinstalls. It does not run the `ci` script. An agent that "verifies" its work with `pnpm ci` sees exit code 0 and reports that CI passed when no check ran. Every later plan in this directory is executed by an agent, so this must be fixed first.

The same two files describe 6 of the 14 packages and describe handoff and runtime flows as if the desktop app runs them. It does not yet. An agent that trusts this map makes wrong assumptions about what is live.

## Current state

Files and their roles:

- `CLAUDE.md` — instructions for Claude Code agents working in this repo.
- `AGENTS.md` — the same content for Codex agents. Its first paragraph differs ("guidance to Codex"); the rest is line-for-line identical to `CLAUDE.md`.
- `docs/architecture.md` — 5 lines that point at a private repository readers cannot open.
- `package.json` (repo root) — defines the real scripts. Do not edit it.

`package.json` scripts (the source of truth; read-only for this plan):

```json
"test": "vitest run",
"coverage": "vitest run --coverage",
"typecheck": "pnpm run typecheck:core && pnpm run typecheck:ui",
"ci": "pnpm typecheck && pnpm coverage && pnpm test:integration",
"test:integration": "vitest run --config vitest.integration.config.ts",
```

`CLAUDE.md` and `AGENTS.md`, lines 7–13 (identical in both files):

````markdown
```bash
pnpm install              # Install all workspace dependencies
pnpm typecheck            # TypeScript strict checking (tsc --noEmit)
pnpm test                 # Run tests (vitest run)
pnpm coverage             # Run tests with 100% coverage enforcement
pnpm ci                   # Full CI pipeline: typecheck + coverage
```
````

`CLAUDE.md` and `AGENTS.md`, "Quality Gates" section (identical in both):

```markdown
Both gates must pass for CI to merge:
- **Typecheck**: `pnpm typecheck` — strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
- **Coverage**: `pnpm coverage` — **100% threshold** on lines, functions, branches, and statements (v8 provider)

Coverage includes all `apps/**/src/**/*.ts` and `packages/**/src/**/*.ts`. Tests live in `{package}/test/*.test.ts`.
```

`CLAUDE.md` and `AGENTS.md`, "### Packages" section lists exactly these six: `policy-client`, `session-agent`, `session-manager`, `drift-detector`, `skill-sync`, `updater`. The repo has 14 packages under `packages/`: `desktop-sync`, `drift-detector`, `environment-monitor`, `local-provisioner`, `mcp-governance`, `mcp-registry`, `mcp-tools-compat`, `policy-client`, `session-agent`, `session-manager`, `settings-reconciler`, `skill-sync`, `telemetry`, `updater`.

`CLAUDE.md` and `AGENTS.md`, "### Key Domain Flows" section (identical in both):

```markdown
1. **Handoff flow**: `handoffAuthorization` -> `handoffOrchestrator` -> `handoffUpload` (tus-based resumable uploads) -> `snapshotAssembly`, governed by `handoffStateMachine` in policy-client
2. **Runtime flow**: `authorization` -> `runtimeOrchestrator` -> `runtimeExecution`, with routing decisions from session-agent's `runtimeRouting`
3. **Policy enforcement**: `policyClient` makes decisions using `controlPlaneContracts`, verified by `handoffVerification`
```

Verified fact about those flows (checked on 2026-11-17 by searching every import in `apps/desktop-companion/src/sidecar/` and `apps/desktop-companion/src/ui/`): no file in the sidecar or the UI imports the handoff, runtime, authorization or snapshot modules, and the sidecar imports neither `@joyus/policy-client` nor `@joyus/session-agent`. Only tests import them.

`docs/architecture.md`, complete file:

```markdown
# Architecture

Pending implementation details.
Use the execution runbook from joyus-ai-internal:
planning/desktop-runtime-execution-plan.md
```

Conventions that apply: these are plain Markdown files. Keep the existing heading structure and the two-space-aligned comment column in the command block. Keep `CLAUDE.md` and `AGENTS.md` identical to each other except for the first paragraph of each.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Confirm what `pnpm ci` is | `pnpm help ci` | output contains `clean-install` |
| Typecheck (sanity only) | `pnpm typecheck` | exit 0 |
| Compare the two agent files | `tail -n +4 CLAUDE.md \| shasum; tail -n +4 AGENTS.md \| shasum` | the two hashes are identical |

Do NOT run `pnpm ci` at any point. Do NOT run `pnpm test` or `pnpm coverage` for this plan: until plan 008 lands, the test suite writes to and deletes a folder under the real home directory. This plan changes only Markdown and needs no test run.

## Scope

**In scope** (the only files you should modify):
- `CLAUDE.md`
- `AGENTS.md`
- `docs/architecture.md`
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch, even though they look related):
- `README.md` — its status table and backlog section contradict each other, but which side is true needs the maintainer. Leave it.
- `CONTRIBUTING.md` — already says `pnpm run ci`. It is correct.
- `package.json` — do not add, rename or remove scripts.
- `docs/release/*`, `docs/rollout/*`, `kitty-specs/*` — status documents that need maintainer input.
- `.claude/`, `.agents/`, `.codex/` — vendored agent tooling.

## Git workflow

- Branch: `docs/007-correct-agent-docs`
- One commit. Message style is conventional commits, for example from this repo's log: `fix: restore CI and desktop build gates`. Use: `docs: correct CI command and package map in agent docs`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Confirm the premise

Run `pnpm help ci`.

**Verify**: the output contains the text `clean-install`. If it does not, STOP (see STOP conditions).

### Step 2: Fix the command block in both files

In `CLAUDE.md` and in `AGENTS.md`, replace this one line:

```
pnpm ci                   # Full CI pipeline: typecheck + coverage
```

with these two lines:

```
pnpm run ci               # Full CI pipeline: typecheck + coverage + integration tests
# Never run `pnpm ci` (without `run`): in pnpm that is clean-install, not this script.
```

**Verify**: `grep -nE '^pnpm ci ' CLAUDE.md AGENTS.md` → no output. `grep -c 'pnpm run ci' CLAUDE.md AGENTS.md` → `CLAUDE.md:1` and `AGENTS.md:1`.

### Step 3: Fix the Quality Gates section in both files

In both files, replace the line `Both gates must pass for CI to merge:` with `All three gates must pass for CI to merge:`.

Add this bullet directly after the `- **Coverage**: ...` bullet:

```markdown
- **Integration**: `pnpm test:integration` — runs `*.integration.test.ts` files with `vitest.integration.config.ts`
```

Replace the sentence that begins `Coverage includes all` with:

```markdown
Coverage includes all `apps/**/src/**/*.ts` and `packages/**/src/**/*.ts`, plus the UI files listed under `coverage.include` in `vitest.config.ts`. A UI component that is not in that list is not measured. Tests live in `{package}/test/*.test.ts`.
```

**Verify**: `grep -c 'All three gates' CLAUDE.md AGENTS.md` → 1 for each file. `grep -c 'Both gates' CLAUDE.md AGENTS.md` → 0 for each file.

### Step 4: Complete the package list in both files

In both files, under `### Packages`, keep the six existing bullets unchanged and add these eight bullets after them, in this order and with this exact text:

```markdown
- **`packages/desktop-sync`** (`@joyus/desktop-sync`) — Local clone lifecycle and sync orchestration helpers
- **`packages/mcp-registry`** (`@joyus/mcp-registry`) — MCP registration, Claude Code integration, process management, and updater wiring
- **`packages/mcp-governance`** (`@joyus/mcp-governance`) — Governance enforcement and MCP telemetry hooks
- **`packages/mcp-tools-compat`** (`@joyus/mcp-tools-compat`) — Compatibility helpers for MCP tool wrappers
- **`packages/telemetry`** (`@joyus/telemetry`) — CLI/Cowork telemetry collection, opt-out handling, and usage reporting
- **`packages/local-provisioner`** (`@joyus/local-provisioner`) — Local site provisioning and runtime detection for DDEV/container workflows
- **`packages/environment-monitor`** (`@joyus/environment-monitor`) — Remote environment discovery, polling, identity, and activity tracking
- **`packages/settings-reconciler`** (`@joyus/settings-reconciler`) — Non-destructive managed settings and MCP entry reconciliation
```

**Verify**: `grep -cE '^- \*\*.packages/' CLAUDE.md` → 14. Same command on `AGENTS.md` → 14.

### Step 5: State what is and is not wired, in both files

In both files, directly after the three numbered items under `### Key Domain Flows`, add this paragraph (leave a blank line before and after it):

```markdown
**Integration status (checked 2026-11-17):** the three flows above are library code with unit tests. The desktop sidecar (`apps/desktop-companion/src/sidecar/`) and the UI do not import them, and the sidecar does not import `@joyus/policy-client` or `@joyus/session-agent`. Do not assume these flows run in the packaged app. Before relying on any cross-layer behavior, check that the UI command, the Rust command in `src-tauri/src/main.rs`, and the sidecar method all exist under the same name.
```

**Verify**: `grep -c 'Integration status (checked 2026-11-17)' CLAUDE.md AGENTS.md` → 1 for each file.

### Step 6: Replace the private pointer in `docs/architecture.md`

Replace the whole file with:

```markdown
# Architecture

This document is a stub. Until it is written, use these sources:

- The component diagram and package list at the top of `README.md`.
- The "Architecture" section of `CLAUDE.md`, including its integration status note.
- `kitty-specs/<feature>/spec.md` and `plan.md` for the design of each feature.

The desktop app has three layers. The React UI (`apps/desktop-companion/src/ui`) calls Tauri commands. The Rust shell (`apps/desktop-companion/src-tauri/src`) registers those commands and forwards most of them to the Node sidecar over line-delimited JSON-RPC on stdio. The sidecar (`apps/desktop-companion/src/sidecar`) registers the JSON-RPC methods and calls into the shared packages.
```

**Verify**: `grep -c 'joyus-ai-internal' docs/architecture.md` → 0.

### Step 7: Confirm the two agent files still match

**Verify**: run `tail -n +4 CLAUDE.md | shasum` and `tail -n +4 AGENTS.md | shasum` → the two hashes are identical. If they differ, find the difference with `tail -n +4 CLAUDE.md > "$TMPDIR/c.txt"; tail -n +4 AGENTS.md > "$TMPDIR/a.txt"; diff "$TMPDIR/c.txt" "$TMPDIR/a.txt"` and apply the missing edit to whichever file lacks it.

## Test plan

No automated tests. These are documentation files. The verification commands in each step are the test.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -nE '^pnpm ci ' CLAUDE.md AGENTS.md` prints nothing
- [ ] `grep -c 'pnpm run ci' CLAUDE.md` prints 1, and the same for `AGENTS.md`
- [ ] `grep -cE '^- \*\*.packages/' CLAUDE.md` prints 14, and the same for `AGENTS.md`
- [ ] `grep -c 'joyus-ai-internal' docs/architecture.md` prints 0
- [ ] `tail -n +4 CLAUDE.md | shasum` and `tail -n +4 AGENTS.md | shasum` print the same hash
- [ ] `git status --short` lists only `CLAUDE.md`, `AGENTS.md`, `docs/architecture.md`, `plans/README.md`
- [ ] `plans/README.md` status row for 007 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `pnpm help ci` does not mention `clean-install` (the pnpm version changed and the premise may no longer hold).
- The excerpts in "Current state" do not match `CLAUDE.md` or `AGENTS.md` (the files have drifted).
- `CLAUDE.md` and `AGENTS.md` already differ from line 4 onward before you start (run the two `shasum` commands from Step 7 first; if the hashes differ, report the difference and stop).
- You find yourself wanting to edit `README.md` or any status document to make it consistent. That needs the maintainer.

## Maintenance notes

- A maintainer should review this change by hand. It edits the instruction files that steer every future agent session in this repo.
- The "Integration status" note carries a date. Whoever wires the handoff or runtime flows into the sidecar, or removes them, must update or delete that note in both files.
- Deferred on purpose: the `README.md` status table says features 006 and 008 are complete while its backlog section says they have work packages in progress. Resolving that needs the maintainer to say which is true. The older plan `plans/005-refresh-status-and-readiness-docs.md` covered that work and was never executed; its line references are stale.
