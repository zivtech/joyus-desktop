# Plan 014: A test fails when the UI, the Rust shell and the sidecar disagree on a command name

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat cea62f6..HEAD -- apps/desktop-companion/src/ui apps/desktop-companion/src-tauri/src apps/desktop-companion/src/sidecar`
> These directories will have changed if other work has merged. That is
> fine: this plan adds a test that reads them, and Step 3 tells you how to
> handle differences. The only STOP-level mismatch is if the call patterns
> shown in "Current state" no longer exist at all.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (adds two test-side files; changes no product code)
- **Depends on**: plans/007-correct-agent-and-contributor-docs.md, plans/008-make-recon-tests-hermetic.md
- **Category**: tests
- **Planned at**: commit `cea62f6`, 2026-11-17

## Why this matters

A user action in this app crosses three layers, and each layer names the command separately, as a string:

1. The React UI calls `invoke("get_config", ...)`.
2. The Rust shell must have a command with that name in its handler list. Most Rust commands forward to the sidecar with `state.send_request("config.get", ...)`.
3. The Node sidecar must have registered that method with `ipc.registerMethod("config.get", ...)`.

Nothing checks that the three lists agree. On `main` today, 16 commands the UI calls have no Rust command, and 9 methods the Rust shell requests have no sidecar handler. Each one is a feature that fails at run time while typecheck and the 100% coverage gate stay green. One example: the app asks for `config.get` at startup to learn whether onboarding is finished; no sidecar method exists, so the answer is never "true".

Because the UI swallows invoke errors (a later plan addresses that), these gaps are invisible in the app too.

After this plan, a unit test extracts the three lists from the source text and compares them. The 25 known gaps are written down in an allowlist that may only shrink. A new mismatch fails CI. A fixed gap must be removed from the list, so the list always shows exactly what is still broken.

## Current state

The app lives in `apps/desktop-companion/`.

**UI calls** (`src/ui/**/*.ts`, `src/ui/**/*.tsx`). The command name is the first string argument, or the second when an invoke function is passed first. Real examples:

```ts
// src/ui/App.tsx
void safeInvoke<string>("get_config", { key: "onboarding_complete" }).then((value) => {

// src/ui/hooks/useRecon.ts:76
const credentials = await safeInvoke<CredentialListItem[]>(invokeFn, "credentials_list");

// src/ui/pages/Sessions.tsx:119  (the name is on the next line)
const result = await safeInvoke<{ hasUncommittedChanges: boolean }>(
  "session_has_uncommitted_changes",
```

A few calls build the name at run time, and no text search can resolve them. These are a known blind spot:

```ts
// src/ui/components/ServerCard.tsx:25
await invoke(cmd, args);
// src/ui/components/LocalSiteCard.tsx:148
void safeInvoke(`site_${op}`, { siteId: site.id })
// src/ui/hooks/useChromeAvailable.ts:37
void safeInvoke<ChromeStatus>(invokeFn, CHROME_DETECT_COMMAND)
```

**Rust handler list** (`src-tauri/src/main.rs`). One macro call lists every command the webview may invoke:

```rust
        .invoke_handler(tauri::generate_handler![
            // ...
            commands::credentials_save,
            commands::credentials_list,
            commands::credentials_verify,
            // ...
            keychain::keychain_list,
        ])
```

**Rust requests to the sidecar** (`src-tauri/src/*.rs`):

```rust
// src-tauri/src/commands.rs:162-163
pub async fn credentials_save(state: State<'_, SidecarState>, params: Value) -> Result<Value, String> {
    state.send_request("credentials.save", params).await
```

**Sidecar methods** (`src/sidecar/**/*.ts`):

```ts
// src/sidecar/credentials.ts:148
  ipc.registerMethod("credentials.save", async (params: unknown): Promise<unknown> => {
```

**What the extraction finds on `main` at `cea62f6`** (measured on 2026-11-17 with the same regular expressions used in Step 2):

| Set | Size |
|---|---|
| UI command names | 48 |
| Rust handler names | 46 |
| Rust `send_request` method names | 35 |
| Sidecar `registerMethod` names | 35 |

UI commands with no Rust handler (16): `clear_usage_data`, `delete_engagement_dir`, `list_engagements`, `open_url`, `recon_mark_failed`, `recon_override_finding`, `retry_servers`, `retry_skill_sync`, `scan_incomplete_engagements`, `session_delete`, `session_get_mode`, `session_has_uncommitted_changes`, `session_list`, `session_resume`, `session_set_mode`, `site_remove`.

Rust requests with no sidecar method (9): `config.get`, `config.set`, `servers.stopAll`, `sites.listLocal`, `sites.listRemote`, `sites.provision`, `sites.restart`, `sites.start`, `sites.stop`.

**Test conventions.** Vitest discovers `**/test/**/*.test.ts` (`vitest.config.ts`). Sidecar tests live in `apps/desktop-companion/test/sidecar/`. Test files are not part of the coverage report (coverage includes `src` only) and are excluded from `tsc` (`tsconfig.json` excludes `**/test/**`), so this plan cannot move either gate.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| The new test only | `pnpm vitest run apps/desktop-companion/test/contract` | all pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Full coverage gate | `pnpm coverage` | exit 0, thresholds met |

Never run `pnpm ci` (that is clean-install in pnpm). The full pipeline is `pnpm run ci`.

Known flaky tests, unrelated to this plan: `apps/desktop-companion/test/ui/SessionsPage.test.ts` ("clears mode note timers…"), `apps/desktop-companion/test/ui/components/LocalSiteCard.test.ts`, and a timing-dependent coverage gap in `ReconSetup.tsx`. If `pnpm coverage` fails only in one of those, rerun it once. If it fails again, treat it as a STOP condition.

## Scope

**In scope** (the only files you should create or modify):
- `apps/desktop-companion/test/contract/knownGaps.ts` (create)
- `apps/desktop-companion/test/contract/ipcContract.test.ts` (create)
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch, even though they look related):
- Every file under `src/` and `src-tauri/`. This plan does not fix a single gap. Do not add a Rust command, a sidecar method, or remove a UI call to make the lists shorter.
- The 21 copies of `safeInvoke` in the UI. A later plan replaces them; when it does, it must update the UI regular expression in this test.
- Checking argument names or payload shapes. This test compares command names only.

## Git workflow

- Branch: `test/014-ipc-contract`
- One commit: `test: add a three-layer IPC command name contract test`. Conventional commits, matching `git log`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Write down the known gaps

Create `apps/desktop-companion/test/contract/knownGaps.ts`:

```ts
/**
 * Known mismatches between the three IPC layers, as of the day this file was
 * created. The contract test requires these lists to match reality exactly.
 *
 * Rules:
 * - Never add a name here to make the test pass. A new mismatch is a bug:
 *   add the missing Rust command or sidecar method instead.
 * - When you fix a gap, delete its name here in the same change. The test
 *   fails until you do.
 */

/** Commands the UI invokes that the Rust shell does not expose. Sorted. */
export const UI_COMMANDS_WITHOUT_RUST_HANDLER: readonly string[] = [
  "clear_usage_data",
  "delete_engagement_dir",
  "list_engagements",
  "open_url",
  "recon_mark_failed",
  "recon_override_finding",
  "retry_servers",
  "retry_skill_sync",
  "scan_incomplete_engagements",
  "session_delete",
  "session_get_mode",
  "session_has_uncommitted_changes",
  "session_list",
  "session_resume",
  "session_set_mode",
  "site_remove",
];

/** Methods the Rust shell requests that the sidecar does not register. Sorted. */
export const RUST_REQUESTS_WITHOUT_SIDECAR_METHOD: readonly string[] = [
  "config.get",
  "config.set",
  "servers.stopAll",
  "sites.listLocal",
  "sites.listRemote",
  "sites.provision",
  "sites.restart",
  "sites.start",
  "sites.stop",
];
```

**Verify**: the file exists and both arrays are in alphabetical order.

### Step 2: Write the contract test

Create `apps/desktop-companion/test/contract/ipcContract.test.ts`:

```ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RUST_REQUESTS_WITHOUT_SIDECAR_METHOD,
  UI_COMMANDS_WITHOUT_RUST_HANDLER,
} from "./knownGaps";

// apps/desktop-companion
const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function listFiles(dir: string, extensions: readonly string[], found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const fullPath = join(dir, name);
    if (statSync(fullPath).isDirectory()) {
      listFiles(fullPath, extensions, found);
    } else if (extensions.some((extension) => name.endsWith(extension))) {
      found.push(fullPath);
    }
  }
  return found;
}

function collect(files: readonly string[], pattern: RegExp): Set<string> {
  const names = new Set<string>();
  for (const file of files) {
    for (const match of readFileSync(file, "utf8").matchAll(pattern)) {
      const name = match[1];
      if (name !== undefined) {
        names.add(name);
      }
    }
  }
  return names;
}

function missingFrom(wanted: ReadonlySet<string>, available: ReadonlySet<string>): string[] {
  return [...wanted].filter((name) => !available.has(name)).sort();
}

// invoke("x"), invoke<T>("x"), safeInvoke("x"), safeInvoke<T>("x"),
// safeInvoke(invokeFn, "x") and safeInvoke<T>(invokeFn, "x").
// Names built at run time (a variable, a template string) are NOT found.
const UI_INVOKE =
  /\b(?:safeInvoke|invoke|invokeFn)\s*(?:<[^>()]*(?:<[^>()]*>[^>()]*)*>)?\s*\(\s*(?:[A-Za-z_$][\w$]*\s*,\s*)?"([a-z][a-z0-9_]*)"/g;
const RUST_SEND_REQUEST = /send_request\(\s*"([A-Za-z][\w.-]*)"/g;
const SIDECAR_REGISTER_METHOD = /registerMethod\(\s*"([A-Za-z][\w.-]*)"/g;

function readRustHandlers(): Set<string> {
  const mainRs = readFileSync(join(APP_ROOT, "src-tauri", "src", "main.rs"), "utf8");
  const block = /generate_handler!\s*\[([\s\S]*?)\]/.exec(mainRs)?.[1] ?? "";
  const handlers = new Set<string>();
  for (const match of block.matchAll(/(?:[a-z_][a-z0-9_]*::)*([a-z_][a-z0-9_]*)\s*(?:,|$)/gm)) {
    const name = match[1];
    if (name !== undefined) {
      handlers.add(name);
    }
  }
  return handlers;
}

const uiCommands = collect(listFiles(join(APP_ROOT, "src", "ui"), [".ts", ".tsx"]), UI_INVOKE);
const rustHandlers = readRustHandlers();
const rustRequests = collect(
  listFiles(join(APP_ROOT, "src-tauri", "src"), [".rs"]),
  RUST_SEND_REQUEST,
);
const sidecarMethods = collect(
  listFiles(join(APP_ROOT, "src", "sidecar"), [".ts"]),
  SIDECAR_REGISTER_METHOD,
);

describe("IPC command name contract", () => {
  it("still finds the call sites in all three layers", () => {
    // If a refactor renames a helper or changes a macro, the patterns above
    // match nothing and every other check here would pass vacuously. These
    // floors make that failure loud. Update the pattern, not the floor.
    expect(uiCommands.size).toBeGreaterThanOrEqual(40);
    expect(rustHandlers.size).toBeGreaterThanOrEqual(40);
    expect(rustRequests.size).toBeGreaterThanOrEqual(30);
    expect(sidecarMethods.size).toBeGreaterThanOrEqual(30);
  });

  it("every command the UI invokes is exposed by the Rust shell, except the known gaps", () => {
    expect(missingFrom(uiCommands, rustHandlers)).toEqual([...UI_COMMANDS_WITHOUT_RUST_HANDLER]);
  });

  it("every method the Rust shell requests is registered by the sidecar, except the known gaps", () => {
    expect(missingFrom(rustRequests, sidecarMethods)).toEqual([
      ...RUST_REQUESTS_WITHOUT_SIDECAR_METHOD,
    ]);
  });
});
```

**Verify**: `pnpm vitest run apps/desktop-companion/test/contract` runs 3 tests.

### Step 3: Reconcile the allowlist with the tree you are on

Look at the result of the command in Step 2.

- **All 3 pass**: go to Step 4.
- **The first test fails** (a size is below its floor): STOP. A pattern no longer matches this codebase.
- **The second or third test fails**: the tree differs from `cea62f6`. Vitest prints `Expected` (the allowlist) and `Received` (reality).
  - A name is in `Expected` but not in `Received`: that gap has been fixed since this plan was written. Delete the name from `knownGaps.ts`.
  - A name is in `Received` but not in `Expected`: that is a mismatch this plan did not know about. Because you are creating the allowlist for the first time, add it to `knownGaps.ts` in sorted position, and list it in your final report under "gaps found beyond the plan". This is the only time a name may be added.

Rerun until all 3 pass.

**Verify**: `pnpm vitest run apps/desktop-companion/test/contract` → 3 passed.

### Step 4: Prove the test can fail

This step makes temporary edits. Revert each one before the next.

1. In `knownGaps.ts`, delete the line `"config.get",`. Run the test. **Expected**: the third test fails and the output mentions `config.get`. Restore the line.
2. In `knownGaps.ts`, add `"not_a_real_command",` to the first array. Run the test. **Expected**: the second test fails. Remove the line.

**Verify**: `git diff --stat` shows no change to `knownGaps.ts` compared with the end of Step 3 (use `git stash` or re-read the file to be sure), and `pnpm vitest run apps/desktop-companion/test/contract` → 3 passed.

### Step 5: Run the full gates

Run `pnpm typecheck`, then `pnpm coverage`.

**Verify**: both exit 0. Commit.

## Test plan

- The plan's deliverable is the test: three cases in `apps/desktop-companion/test/contract/ipcContract.test.ts`.
- Step 4 is the test of the test: it must fail when a gap is removed from the list without being fixed, and when a name is listed that is not a gap.
- Verification: `pnpm vitest run apps/desktop-companion/test/contract` → 3 passed.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm vitest run apps/desktop-companion/test/contract` exits 0 with 3 tests
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm coverage` exits 0
- [ ] `git status --short` lists only the two new files and `plans/README.md`
- [ ] `git diff --stat main..HEAD -- apps/desktop-companion/src apps/desktop-companion/src-tauri` prints nothing
- [ ] Your report lists any name you added or removed in Step 3 compared with the lists in this plan
- [ ] `plans/README.md` status row for 014 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The first test fails (a floor is not met). Report the four sizes you measured.
- More than 5 names differ from this plan's lists in Step 3. That much drift means the tree has changed in a way this plan did not anticipate; report the two `Received` lists.
- You find yourself editing a file under `src/` or `src-tauri/`.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- **Blind spots.** Command names built at run time are not checked: `ServerCard.tsx` (`invoke(cmd, args)`), `LocalSiteCard.tsx` (`` `site_${op}` ``), and `useChromeAvailable.ts` (a constant). A mismatch there still passes. Prefer string literals at call sites.
- **What it does not check.** Argument names and payload shapes. A Rust command that expects `engagementId` while the UI sends `engagement_id` passes this test.
- **When the UI invoke helper changes** (the planned replacement of the 21 `safeInvoke` copies), update `UI_INVOKE` in the same change. The first test's floor will fail if you forget.
- **Informational, not asserted.** Nine sidecar methods are registered but never requested by the Rust shell: `session.delete`, `session.fileModified`, `session.getMode`, `session.hasUncommittedChanges`, `session.list`, `session.resume`, `session.setMode`, `recon.checkVersion`, `state.reportError`. The first seven are the session features whose Rust commands do not exist yet.
- **Which gaps get built** (maintainer decision D1 in `plans/README.md`): `config.get` and `config.set`, and the session commands. The others stay on the list, visible, until someone decides to build or delete each one.
- Reviewer focus: the allowlist in the committed file must equal what the test extracts, and no file outside `test/contract/` may change.
