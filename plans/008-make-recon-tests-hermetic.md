# Plan 008: Recon tests never touch the real home directory, and `recon.create` honors an injected root

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat cea62f6..HEAD -- apps/desktop-companion/src/sidecar/recon.ts apps/desktop-companion/test/sidecar/recon.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/007-correct-agent-and-contributor-docs.md
- **Category**: tests
- **Planned at**: commit `cea62f6`, 2026-11-17

## Why this matters

Running the unit tests today deletes a real user folder. The recon feature stores client engagement data under `~/Documents/joyus-recon-engagements`. `recon.create` always writes there, even when a test passes a different root. The first recon test then removes the parent of the directory it created, which is the whole engagements folder, with a recursive forced delete. Anyone who runs `pnpm test` on a machine that holds real engagements loses them.

The same defect makes the suite fail anywhere the home directory is not writable (sandboxes, locked-down CI images): 14 tests fail with `EPERM` and then time out.

A second defect hides in the same file: five "the file exists" assertions call a mocked function that always returns `true`, so they cannot fail.

After this plan, recon tests write only under the operating system's temp directory, and the production code path is unchanged when no root is injected.

## Current state

Files:

- `apps/desktop-companion/src/sidecar/recon.ts` — sidecar handlers `recon.create`, `recon.scan`, `recon.export`, `recon.checkVersion`. Contains the hardcoded path.
- `apps/desktop-companion/test/sidecar/recon.test.ts` — 1,032 lines, 35 tests. Contains the destructive cleanup.
- `apps/desktop-companion/test/sidecar/credentials.test.ts` — the exemplar for mocking `os.homedir()` in this repo. Read lines 40–60 before starting. Do not modify it.

`recon.ts` already has an injectable root, used by `recon.scan` and `recon.export` but not by `recon.create`:

```ts
// apps/desktop-companion/src/sidecar/recon.ts:23
import * as os from "node:os";

// :56-58
export interface ReconRuntimeDeps {
  engagementRoot?: string;
}

// :108-110
function defaultEngagementRoot(): string {
  return path.join(os.homedir(), "Documents", "joyus-recon-engagements");
}

// :122-126  (used by scan and export)
async function resolveAllowedEngagementDir(
  engagementDir: string,
  deps: ReconRuntimeDeps,
): Promise<string> {
  const configuredRoot = deps.engagementRoot ?? defaultEngagementRoot();

// :222-226
export function registerReconMethods(
  ipc: IpcHandler,
  syncDeps?: ReconSyncDeps,
  runtimeDeps: ReconRuntimeDeps = {},
): void {

// :290-295  (inside the "recon.create" handler — THE DEFECT: ignores runtimeDeps)
    const engagementDir = path.join(
      os.homedir(),
      "Documents",
      "joyus-recon-engagements",
      clientSlug,
    );
```

`recon.test.ts` mocks `node:fs` so that `existsSync` always returns `true`, then imports that same mocked function under a misleading name:

```ts
// apps/desktop-companion/test/sidecar/recon.test.ts:27
import { mkdtempSync, rmSync, existsSync as realExistsSync } from "node:fs";

// :40-46
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
  };
});

// :388  (proof that realExistsSync IS the mock)
  const existsSyncMock = vi.mocked(realExistsSync);
```

Because of that, every `expect(realExistsSync(x)).toBe(true)` passes no matter what. There are five: lines 316, 320, 686, 742, 795.

The temp-dir helpers:

```ts
// :137-145
function makeTempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "recon-test-"));
}

function removeTempDir(dir: string): void {
  if (realExistsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}
```

The destructive test and its cleanup:

```ts
// :219-248
describe("slugify (via recon.create)", () => {
  let ipc: InvokableMockIpc;
  let tempDir: string;

  beforeEach(() => {
    ipc = makeIpc();
    registerReconMethods(ipc);
    // recon.create writes to ~/Documents/joyus-recon-engagements — redirect to a
    // temp dir by monkey-patching os.homedir isn't viable in ESM.
    // ...
    tempDir = "";
  });

  afterEach(() => {
    if (tempDir !== "" && realExistsSync(tempDir)) {
      removeTempDir(tempDir);
    }
  });

  it("slugifies simple spaces to hyphens", async () => {
    const result = (await ipc._invoke("recon.create", {
      clientName: "Acme Corp",
      url: "https://acme.example.com",
      accessMode: "rfp",
    })) as { clientSlug: string; engagementDir: string };
    tempDir = path.dirname(result.engagementDir); // parent is clientSlug dir
    expect(result.clientSlug).toBe("acme-corp");
    removeTempDir(result.engagementDir);
  });
```

`result.engagementDir` is `<home>/Documents/joyus-recon-engagements/acme-corp`. Its `path.dirname` is the engagements root. `afterEach` deletes it.

Every place the test file registers the handlers (line numbers at commit `cea62f6`):

| Line | Describe block | Root injected today? | Creates directories? |
|---|---|---|---|
| 225 | `slugify (via recon.create)` | no | yes (4 tests) |
| 295 | `recon.create` | no | yes (happy path) |
| 395 | `resolveScanScript` | yes (`tmpRoot`) | — |
| 443 | `recon.scan` | yes (`tmpRoot`) | — |
| 577 | `recon.scan` → "uses the default recon engagement root…" | no, on purpose | yes, under the real home |
| 607 | `recon.export` | yes (`tmpRoot`) | — |
| 869, 896 | `recon.checkVersion` | no | no |
| 925 | version gate → "blocks creation…" | no | no (rejects first) |
| 947, 976 | version gate → "allows creation…" (2 tests) | no | yes |
| 996, 1014 | version gate → "wraps mkdir/writeFile errors" | no | no (`mkdir` is mocked) |

The already-correct pattern to copy (from the `recon.scan` block, lines 433–447):

```ts
  let tmpRoot: string;
  beforeEach(async () => {
    tmpRoot = makeTempDir();
    // ...
    registerReconMethods(ipc, undefined, { engagementRoot: tmpRoot });
  });
  afterEach(() => { removeTempDir(tmpRoot); /* ... */ });
```

The exemplar for mocking the home directory (`credentials.test.ts:51-59`):

```ts
const homedirBox = vi.hoisted(() => ({ value: "" }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: () => homedirBox.value,
  };
});
```

Repo conventions: TypeScript strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Vitest. Coverage must stay at 100% lines, functions, branches and statements, so both sides of every `??` in `recon.ts` need a test.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Recon tests only | `pnpm vitest run apps/desktop-companion/test/sidecar/recon.test.ts` | all pass |
| Full coverage gate | `pnpm coverage` | exit 0, thresholds met |
| Real folder fingerprint (macOS) | `stat -f %m ~/Documents/joyus-recon-engagements` | prints a number, or "No such file" |
| Real folder fingerprint (Linux) | `stat -c %Y ~/Documents/joyus-recon-engagements` | prints a number, or "No such file" |

Never run `pnpm ci` (that is clean-install in pnpm). The full pipeline is `pnpm run ci`.

Known flaky tests, unrelated to this plan: `apps/desktop-companion/test/ui/SessionsPage.test.ts` ("clears mode note timers…"), `apps/desktop-companion/test/ui/components/LocalSiteCard.test.ts`, and a timing-dependent coverage gap in `ReconSetup.tsx`. If `pnpm coverage` fails only in one of those, rerun it once. If it fails again, treat it as a STOP condition.

## Scope

**In scope** (the only files you should modify):
- `apps/desktop-companion/src/sidecar/recon.ts` (one expression in the `recon.create` handler)
- `apps/desktop-companion/test/sidecar/recon.test.ts`
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch, even though they look related):
- `slugify`, `isWithinPath`, the on-disk directory layout, and the export code in `recon.ts` — plan 010 changes those. Changing them here makes that plan's excerpts stale.
- `apps/desktop-companion/src-tauri/src/recon.rs` — the Rust side receives the engagement directory from the UI and does not build the path itself. Nothing to change there for this plan.
- `vitest.config.ts` — do not add a global setup file or change `HOME` for the whole suite. Other tests run real `git` commands that read `~/.gitconfig`; redirecting `HOME` globally would break them.
- `apps/desktop-companion/test/sidecar/credentials.test.ts` — exemplar only.

## Git workflow

- Branch: `fix/008-hermetic-recon-tests`
- Two commits: (1) `fix: honor injected engagement root in recon.create`, (2) `test: keep recon tests out of the real home directory`. Conventional commits, matching `git log` (example: `fix: harden desktop security and CI gates`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Protect real data before touching anything

Run `ls -A ~/Documents/joyus-recon-engagements 2>/dev/null | head -5`.

- If it prints any entry, STOP. Real engagement data is present; the operator must back it up first.
- If it prints nothing, record the folder's fingerprint with the `stat` command for your OS from the table above (or record "absent" if the folder does not exist). You will compare it at the end.

Do NOT run any recon test until Step 6. The current test file deletes that folder.

**Verify**: you have written down either a number or "absent".

### Step 2: Make `recon.create` use the injected root

In `apps/desktop-companion/src/sidecar/recon.ts`, inside the `recon.create` handler, replace:

```ts
    const engagementDir = path.join(
      os.homedir(),
      "Documents",
      "joyus-recon-engagements",
      clientSlug,
    );
```

with:

```ts
    const engagementDir = path.join(
      runtimeDeps.engagementRoot ?? defaultEngagementRoot(),
      clientSlug,
    );
```

`runtimeDeps` is the third parameter of `registerReconMethods` and is in scope inside the handler. Change nothing else in this file.

**Verify**: `pnpm typecheck` → exit 0. `grep -c 'os.homedir()' apps/desktop-companion/src/sidecar/recon.ts` → 1 (only inside `defaultEngagementRoot`).

### Step 3: Mock the home directory for the whole test file

In `recon.test.ts`:

1. Add `afterAll` to the `vitest` import list, and add `readdirSync` and `statSync` to the `node:fs` import on line 27.
2. Directly below the existing `vi.mock("node:child_process", ...)` block, add the `homedirBox` and `vi.mock("node:os", ...)` code exactly as shown in the exemplar excerpt above.
3. Directly below the line `import type { IpcHandler, MethodHandler } from "../../src/sidecar/ipc-handler";`, add:

```ts
// Every test in this file sees this temp directory as the home directory, so
// no code path can reach the real ~/Documents/joyus-recon-engagements.
const FAKE_HOME = mkdtempSync(path.join(os.tmpdir(), "recon-fake-home-"));
homedirBox.value = FAKE_HOME;
const FAKE_DEFAULT_ROOT = path.join(FAKE_HOME, "Documents", "joyus-recon-engagements");

/** True existence check. `existsSync` is mocked to always return true in this file. */
function pathExists(target: string): boolean {
  return statSync(target, { throwIfNoEntry: false }) !== undefined;
}

afterAll(() => {
  const leftovers = pathExists(FAKE_DEFAULT_ROOT) ? readdirSync(FAKE_DEFAULT_ROOT) : [];
  rmSync(FAKE_HOME, { recursive: true, force: true });
  // A test that used the default root must clean up what it created there.
  expect(leftovers).toEqual([]);
});
```

`os.tmpdir()` still works because the mock spreads the real module and overrides only `homedir`.

**Verify**: `pnpm typecheck` → exit 0.

### Step 4: Replace the fake existence checks

1. Rename the import on line 27 from `existsSync as realExistsSync` to `existsSync as mockedExistsSync`, and update line 388 to `const existsSyncMock = vi.mocked(mockedExistsSync);`.
2. Change `removeTempDir` to:

```ts
function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
```

3. Replace every remaining `realExistsSync(` with `pathExists(`. At commit `cea62f6` those are lines 316, 320, 686, 742, 795, 959, 988 (line 235 is removed in Step 5).

**Verify**: `grep -c 'realExistsSync' apps/desktop-companion/test/sidecar/recon.test.ts` → 0.

### Step 5: Inject a temp root wherever a test creates directories

Apply the "already-correct pattern" from Current state to these blocks:

1. **`describe("slugify (via recon.create)")`** (line 219). Replace `let tempDir: string;` with `let tmpRoot: string;`. In `beforeEach`, set `tmpRoot = makeTempDir();` and register with `registerReconMethods(ipc, undefined, { engagementRoot: tmpRoot });`. Delete the comment block about monkey-patching. Replace `afterEach` with `afterEach(() => { removeTempDir(tmpRoot); });`. In each of the four tests, delete the `tempDir = ...` line and the `removeTempDir(result.engagementDir);` line. In the first test ("slugifies simple spaces to hyphens"), add this assertion after the slug assertion:

```ts
    // Regression: recon.create must build the path from the injected root.
    expect(path.dirname(result.engagementDir)).toBe(tmpRoot);
```

2. **`describe("recon.create")`** (line 290). Add `let tmpRoot: string;`, create it in `beforeEach`, register with `{ engagementRoot: tmpRoot }`, and add `afterEach(() => { removeTempDir(tmpRoot); });`. In the happy-path test, remove the `try { ... } finally { removeTempDir(result.engagementDir); }` wrapper and keep the assertions.

3. **`describe("recon.create with syncDeps (version gate)")`** (line 909). Add `let tmpRoot: string;`. In the existing `beforeEach`, add `tmpRoot = makeTempDir();`. Add `afterEach(() => { removeTempDir(tmpRoot); });`. In the two tests named "allows creation when version matches…" and "allows creation when version is stale…", change the registration to `registerReconMethods(ipc, { getSyncStatus, triggerSync }, { engagementRoot: tmpRoot });` and replace each `try { ... } finally { ... }` with the plain body (the `afterEach` now cleans up). Leave the other three tests in this block as they are: they never create a directory.

4. **The default-root scan test** (line 568, "uses the default recon engagement root when no runtime root is injected"). Keep it. `os.homedir()` now returns `FAKE_HOME` in both the test and the production code. Add as its first assertion:

```ts
    expect(defaultRoot).toBe(FAKE_DEFAULT_ROOT);
```

5. **Add one new test** at the end of `describe("recon.create")`, so the default-root branch of `recon.create` stays covered:

```ts
  it("uses the default engagement root when no runtime root is injected", async () => {
    const defaultIpc = makeIpc();
    registerReconMethods(defaultIpc);

    const result = (await defaultIpc._invoke("recon.create", {
      clientName: "Default Root Co",
      url: "https://default.example.com",
      accessMode: "rfp",
    })) as { engagementDir: string };

    try {
      expect(result.engagementDir).toBe(path.join(FAKE_DEFAULT_ROOT, "default-root-co"));
      expect(pathExists(result.engagementDir)).toBe(true);
    } finally {
      removeTempDir(result.engagementDir);
    }
  });
```

**Verify**: `pnpm typecheck` → exit 0. `grep -c 'path.dirname(result.engagementDir); // parent' apps/desktop-companion/test/sidecar/recon.test.ts` → 0.

### Step 6: Run the recon tests, then prove the real folder was not touched

Run `pnpm vitest run apps/desktop-companion/test/sidecar/recon.test.ts`.

**Verify**: all tests pass (36: the original 35 plus the new one). Then rerun the `stat` command from Step 1. The value must equal what you recorded, or the folder must still be absent. If it differs, STOP.

### Step 7: Run the full gates

Run `pnpm typecheck`, then `pnpm coverage`.

**Verify**: both exit 0 and the coverage summary shows 100% for `recon.ts`. Rerun the `stat` command one more time; the value must still match Step 1.

## Test plan

- New test: "uses the default engagement root when no runtime root is injected" in `describe("recon.create")` — covers the default branch safely under the fake home.
- New assertion in "slugifies simple spaces to hyphens" — the regression test for the defect: fails if `recon.create` ignores the injected root.
- New `afterAll` tripwire — fails the file if any test leaves entries in the fake default root.
- Seven existence checks now use a real filesystem check (`pathExists`) instead of the always-true mock.
- Structural pattern: the existing `recon.scan` block in the same file.
- Verification: `pnpm vitest run apps/desktop-companion/test/sidecar/recon.test.ts` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm vitest run apps/desktop-companion/test/sidecar/recon.test.ts` exits 0
- [ ] `pnpm coverage` exits 0
- [ ] `grep -c 'realExistsSync' apps/desktop-companion/test/sidecar/recon.test.ts` prints 0
- [ ] `grep -c 'os.homedir()' apps/desktop-companion/src/sidecar/recon.ts` prints 1
- [ ] `grep -c 'engagementRoot: tmpRoot' apps/desktop-companion/test/sidecar/recon.test.ts` prints 7 or more
- [ ] The `stat` fingerprint of `~/Documents/joyus-recon-engagements` after the last test run equals the one recorded in Step 1 (or the folder is still absent)
- [ ] `git status --short` lists only the two in-scope source files and `plans/README.md`
- [ ] `plans/README.md` status row for 008 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `~/Documents/joyus-recon-engagements` contains anything in Step 1.
- The fingerprint of that folder changes at any point after Step 1.
- The code at the locations in "Current state" does not match the excerpts.
- After Step 4, one of the existence assertions (lines 316, 320, 686, 742, 795) fails. That means the production code never created the file and the old always-true check was hiding it. Report which assertion failed; do not weaken it.
- The new `expect(path.dirname(result.engagementDir)).toBe(tmpRoot)` assertion fails after Step 2 (for example because the temp path is rewritten somewhere). Do not relax it to a looser match.
- Coverage for `recon.ts` drops below 100% and the cause is not one of the edits in this plan.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The fake home is per-file. Any new test file that calls `registerReconMethods` without `engagementRoot` writes to the real home again. Reviewers should reject such tests. A suite-wide guard was considered and left out: redirecting `HOME` globally breaks tests that run real `git`.
- `defaultEngagementRoot()` in `recon.ts` is the only place the `~/Documents/joyus-recon-engagements` path is built. The Rust command `launch_recon` receives the directory from the UI and does not check it against that root.
- Plan 010 changes `slugify` and path containment in this same file and must run after this one.
- Reviewer focus: confirm no remaining call to `registerReconMethods(` in the test file creates directories without `engagementRoot`, and that the `afterAll` tripwire is present.
