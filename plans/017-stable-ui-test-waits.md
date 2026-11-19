# Plan 017: UI tests wait on real time, not on a count of loop turns

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat ec00055..HEAD -- apps/desktop-companion/test/ui/pageTestUtils.ts apps/desktop-companion/test/ui/SessionsPage.test.ts apps/desktop-companion/test/ui/SitesPage.test.ts apps/desktop-companion/test/ui/hooks.test.ts apps/desktop-companion/test/ui/ReconSetupPage.test.ts apps/desktop-companion/test/ui/components/LocalSiteCard.test.ts`
> Expected: no output. If a file shows changes, compare it with the code
> quoted in "Current state". If the quoted code no longer matches, treat it
> as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (test files only; nothing under `src/` changes)
- **Depends on**: plans/008-make-recon-tests-hermetic.md (only so that running the full suite is safe on your machine)
- **Category**: tests, CI reliability
- **Planned at**: commit `ec00055`, 2026-11-18
- **Reference implementation**: this plan was written from a working prototype, not from reasoning. The prototype is two local commits, `dfd04f1` and `877b55d`, on branch `probe/017-flaky-ui-tests`. That branch may not exist on your machine. Do not depend on it; everything you need is in this file. If it does exist, Step 8 uses it as a cross-check.

## Why this matters

CI failed at random on three of five consecutive runs on 2026-11-17 and 2026-11-18. None of the three pull requests touched the failing tests. One of them changed only Markdown files.

The failures look like three different problems. They share one cause.

Every UI page and component loads a Tauri module on demand before it acts, for example `await import("@tauri-apps/api/core")`. A dynamic `import()` needs at least one real turn of the event loop, and real time, to finish. Every UI test waits for the result with a hand-written helper that loops a fixed number of times. The helpers count loop turns. They do not measure time. On a busy machine, such as a CI runner running 146 test files in parallel, the loop can use up all its turns in a few milliseconds, before the import finishes.

The measured failures:

1. **`SessionsPage.test.ts`, "clears mode note timers when modes change and on unmount".** This test replaces `setTimeout` with a version that runs handlers at once. The file's `waitFor` pauses with `setTimeout(resolve, 0)`, so in this test its 80 turns take about 2 ms in total. Measured timeouts were 3.71 ms and 0.53 ms. The page finished loading just after the last check.
2. **`LocalSiteCard.test.ts`, "opens HTTPS URLs through the shell plugin".** Its helper, `waitForInvokeCount`, loops 10 times and then returns without an error. Under load it gave up after 14.8 ms with zero calls recorded. The late call then landed in the next test's mock, so the next test failed too. One run failed three tests this way.
3. **`OnboardingPage.test.ts`** timed out once through the shared `waitFor` in `pageTestUtils.ts`, which has the same 80-turn limit.
4. **Coverage gate, `src/ui/pages/ReconSetup.tsx` lines 336–342.** These lines render a "Checking skill file…" spinner. No test asserts that spinner. The lines were covered only when React happened to paint the spinner before the check returned. With `ReconSetupPage.test.ts` run alone, 5 of 10 runs left them uncovered. When that happens in CI, every test passes and the 100% coverage gate fails.

How often, before this plan: with 30 busy processes plus the full suite on an 18-core machine, 6 of 22 runs had a failing test and 2 more failed the coverage gate. With the prototype of this plan applied, 20 of 20 such runs were clean.

After this plan: one shared `waitFor` polls against a 3-second real-time deadline, cannot be shortened by a test that replaces `setTimeout`, and always throws with a message on timeout. Every UI test file uses it. The spinner has its own test.

## Current state

All paths are under `apps/desktop-companion/`. All six files are test files. They are identical at `ec00055` and on the plan 008 branch.

### `test/ui/pageTestUtils.ts` — the shared helper (lines 75–83)

```ts
export async function waitFor(predicate: () => boolean, attempts = 80): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (predicate()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  throw new Error("Timed out waiting for condition");
}
```

The function directly above it is `mount(...)`. The function directly below it is `findButton(...)`. The file already imports `act` from `"react"`. No caller anywhere passes the second argument `attempts`.

Six page test files import this `waitFor` and need no edit: `DashboardPage`, `UsagePage`, `ReconDashboardPage`, `OnboardingPage`, `SettingsPage` and `SkillsPage`. They pick up the new behaviour. `ReconSetupPage` imports it too; you edit that file only in Step 6.

### `test/ui/SessionsPage.test.ts` — a private copy (lines 35–43)

```ts
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 80; i++) {
    if (predicate()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  throw new Error("Timed out waiting for condition");
}
```

Its imports end with these two lines (lines 8–9):

```ts
import type { TaskBranch } from "../../src/ui/components/TaskBranchCard";
import { installTauriInternals } from "./tauriInternals";
```

Inside the test "clears mode note timers when modes change and on unmount" there are three waits on a counter:

```ts
    await waitFor(() => modeTimers.length === 1);
```
```ts
    await waitFor(() => modeTimers.length === 2);
```
```ts
    await waitFor(() => modeTimers.length === 3);
```

`act` is still used elsewhere in this file (`click`, `mountSessions`). Keep its import.

### `test/ui/components/LocalSiteCard.test.ts` — the silent helper (lines 19–26)

```ts
async function waitForInvokeCount(count: number): Promise<void> {
  for (let i = 0; i < 10; i++) {
    if (invokeMock.mock.calls.length >= count) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}
```

Its last import (line 7):

```ts
import { LocalSiteCard, type LocalSite } from "../../../src/ui/components/LocalSiteCard";
```

`act` is still used elsewhere in this file. Keep its import.

### `test/ui/SitesPage.test.ts` — a private copy (lines 66–74)

Identical text to the `SessionsPage.test.ts` copy above. Its imports end with (lines 9–10):

```ts
import type { TaskBranch } from "../../src/ui/components/TaskBranchCard";
import { installTauriInternals } from "./tauriInternals";
```

`act` is still used elsewhere in this file. Keep its import.

### `test/ui/hooks.test.ts` — a private copy (lines 57–63)

```ts
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (predicate()) return;
    await flushEffects();
  }
  throw new Error("Timed out waiting for condition");
}
```

The top of the file (lines 1–6):

```ts
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChromeAvailable } from "../../src/ui/hooks/useChromeAvailable";
```

`flushPromises` and `flushEffects` in this file stay as they are. They are still used.

### `test/ui/ReconSetupPage.test.ts` — where the new test goes

The file already imports `waitFor` and `installTauriInternals`, and defines `mountReconSetup()` and `advanceThroughCredentials()`. The first test ends like this, and the second test follows it:

```ts
    await advanceThroughCredentials();
    expect(harness.container.textContent).toContain("Syncing Recon Operator skill");
    await waitFor(() => harness.container.textContent?.includes("Recon Operator skill ready (v9.9.9)") === true);
    await clickButton(harness, "Finish");
  });

  it("supports retrying Claude detection after a failed check", async () => {
```

### The source being covered (read only — do not edit)

`src/ui/pages/ReconSetup.tsx`, lines 307–314, sets the state that lines 336–342 render:

```ts
    setState("checking");
    const result = await safeInvoke<{ found: boolean }>("check_skill_file");
```

then, when `result.found` is true, `setState("found")`.

## Commands you will need

Run every command from the repository root.

| Purpose | Command | Notes |
|---|---|---|
| Install | `pnpm install --frozen-lockfile` | Only if `node_modules` is missing |
| Typecheck | `pnpm typecheck` | Must print no errors. It checks `src/` only: both `tsconfig.json` files leave out `test/`. It cannot catch a mistake in a test file |
| UI tests | `pnpm vitest run apps/desktop-companion/test/ui` | About 2 seconds |
| One file | `pnpm vitest run <path to test file>` | |
| Full gate | `pnpm coverage` | All tests plus 100% coverage. About 15 seconds |

Do NOT run `pnpm ci`. In pnpm that is a clean install, not this repository's pipeline.

## Scope

**In scope — the only files you may change:**

- `apps/desktop-companion/test/ui/pageTestUtils.ts`
- `apps/desktop-companion/test/ui/SessionsPage.test.ts`
- `apps/desktop-companion/test/ui/SitesPage.test.ts`
- `apps/desktop-companion/test/ui/hooks.test.ts`
- `apps/desktop-companion/test/ui/ReconSetupPage.test.ts`
- `apps/desktop-companion/test/ui/components/LocalSiteCard.test.ts`
- `plans/README.md` (the status row for plan 017 only, and only if no reviewer maintains it; leave the "Known flaky tests" line near the top for the reviewer)

**Out of scope — do not touch, even though they look related:**

- Anything under `apps/desktop-companion/src/`. The components are correct. If you believe a source change is needed, STOP.
- `flushPromises` and `flushEffects` in `hooks.test.ts`.
- The bare `await new Promise((resolve) => setTimeout(resolve, 0))` lines inside `act(...)` in any test file, and inside `clickButton`, `teardownDom` and the other helpers in `pageTestUtils.ts`. They are single pauses, not waits on a condition. Leave them.
- `components/TaskBranchCard.test.ts`. It uses `vi.useFakeTimers()` and has no wait helper.
- `vitest.config.*`, `package.json`, and any timeout or retry setting. Do not add `retry`. Do not add dependencies; `@testing-library/*` is deliberately not installed.
- The other six page test files that import `waitFor`. They need no edit.

## Git workflow

- Branch: `test/017-stable-ui-test-waits`, cut from the default branch once plan 008 has landed there. If plan 008 exists only as branch `fix/008-hermetic-recon-tests`, cut from that branch and say so in your report.
- Commits: conventional commits. Suggested: one commit for Steps 2–5 (`test: bound UI waits by real time and share one waitFor`), one for Step 6 (`test: cover the ReconSetup checking state`).
- Do not push. Do not open a pull request. Report and stop.

## Steps

### Step 1: Confirm plan 008 has landed, and record the baseline

Run:

- `grep -c 'function pathExists' apps/desktop-companion/test/sidecar/recon.test.ts` → must print `1`

If it prints `0`, STOP: plan 008 is not done, and running the full suite could delete a real folder in your home directory.

Then run `pnpm vitest run apps/desktop-companion/test/ui` and `pnpm coverage`. Write down both "Tests" totals. Expected for the UI folder: `27 passed` files, `175 passed` tests. The full total depends on which other plans have landed; call it **N**.

If a test fails here, run the command once more. These are the flaky tests this plan fixes, so one failure of `SessionsPage`, `LocalSiteCard`, `OnboardingPage` or the `ReconSetup.tsx` coverage line is expected now and then. Any other failure, or the same failure twice in a row, is a STOP condition.

**Verify**: you have both totals written down.

### Step 2: Replace the shared `waitFor`

In `apps/desktop-companion/test/ui/pageTestUtils.ts`, replace the whole `waitFor` function quoted in "Current state" with exactly this:

```ts
// Captured at module load, before any test can spy on, mock, or fake the globals.
// A test that replaces `setTimeout` (or installs fake timers) must not change how
// `waitFor` yields or how it measures time, or its budget collapses to a few ms.
const realSetTimeout = globalThis.setTimeout.bind(globalThis);
const realNow = performance.now.bind(performance);

const WAIT_FOR_TIMEOUT_MS = 3_000;

/**
 * Polls `predicate` inside `act` until it is true or a wall-clock deadline passes.
 * Throws on timeout. The budget is real elapsed time, not an iteration count,
 * because a loaded machine can take far longer than N event-loop turns to finish
 * work such as a dynamic `import()`.
 */
export async function waitFor(
  predicate: () => boolean,
  description: string | (() => string) = "condition",
  timeoutMs = WAIT_FOR_TIMEOUT_MS,
): Promise<void> {
  const deadline = realNow() + timeoutMs;
  for (;;) {
    if (predicate()) return;
    if (realNow() >= deadline) {
      const text = typeof description === "function" ? description() : description;
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${text}`);
    }
    await act(async () => {
      await new Promise((resolve) => realSetTimeout(resolve, 1));
    });
  }
}
```

Why each part is there, so you do not "simplify" it:

- `realSetTimeout` and `realNow` are captured once, at the top level of the module. Do not move them inside the function. A test may replace `globalThis.setTimeout` before it calls `waitFor`.
- `performance.now`, not `Date.now`. Some tests replace `Date.now`.
- `description` may be a function so the message can report a value as it is at the timeout, not as it was before the wait.
- 3,000 ms is below Vitest's 5,000 ms default test timeout, so a real failure reports this message, not a generic test timeout.

**Verify**: `pnpm vitest run apps/desktop-companion/test/ui` → `27 passed`, `175 passed`. This test run is the real check. Nothing in this repository type-checks test files, so compare what you pasted with the block above, character for character.

### Step 3: Make `SessionsPage.test.ts` use the shared helper

In `apps/desktop-companion/test/ui/SessionsPage.test.ts`:

1. Add this import directly above the `installTauriInternals` import:

   ```ts
   import { waitFor } from "./pageTestUtils";
   ```

2. Delete the whole local `async function waitFor(...)` quoted in "Current state", and the blank line after it.

3. In the test "clears mode note timers when modes change and on unmount", give the three counter waits a description:

   ```ts
       await waitFor(() => modeTimers.length === 1, "mode-note timer #1 to be armed");
   ```
   ```ts
       await waitFor(() => modeTimers.length === 2, "mode-note timer #2 to be armed");
   ```
   ```ts
       await waitFor(() => modeTimers.length === 3, "mode-note timer #3 to be armed");
   ```

Change no other line.

**Verify**: `pnpm vitest run apps/desktop-companion/test/ui/SessionsPage.test.ts` → all tests pass. `grep -c 'i < 80' apps/desktop-companion/test/ui/SessionsPage.test.ts` → `0`.

### Step 4: Make `waitForInvokeCount` throw

In `apps/desktop-companion/test/ui/components/LocalSiteCard.test.ts`:

1. Add this import directly below the `LocalSiteCard` import (note the path: one level up):

   ```ts
   import { waitFor } from "../pageTestUtils";
   ```

2. Replace the whole `waitForInvokeCount` function with:

   ```ts
   async function waitForInvokeCount(count: number): Promise<void> {
     await waitFor(
       () => invokeMock.mock.calls.length >= count,
       () => `invoke to be called ${count} time(s); got ${invokeMock.mock.calls.length}`,
     );
   }
   ```

The second argument must be a function (`() => ...`). A plain template string would report the call count from before the wait.

**Verify**: `pnpm vitest run apps/desktop-companion/test/ui/components/LocalSiteCard.test.ts` → `24 passed`. `grep -c 'i < 10' apps/desktop-companion/test/ui/components/LocalSiteCard.test.ts` → `0`.

### Step 5: Remove the last two private copies

In `apps/desktop-companion/test/ui/SitesPage.test.ts`:

1. Add `import { waitFor } from "./pageTestUtils";` directly above the `installTauriInternals` import.
2. Delete the whole local `async function waitFor(...)` and the blank line after it.

In `apps/desktop-companion/test/ui/hooks.test.ts`:

1. Add `import { waitFor } from "./pageTestUtils";` on its own line directly above the `useChromeAvailable` import (after the blank line that follows the `vitest` import).
2. Delete the whole local `async function waitFor(...)` and the blank line after it. Keep `flushPromises` and `flushEffects`.

**Verify**:

- `grep -rn 'async function waitFor(' apps/desktop-companion/test/ui` → exactly one line, in `pageTestUtils.ts`.
- `grep -c "act(" apps/desktop-companion/test/ui/SessionsPage.test.ts apps/desktop-companion/test/ui/SitesPage.test.ts apps/desktop-companion/test/ui/hooks.test.ts apps/desktop-companion/test/ui/components/LocalSiteCard.test.ts` → every count is above `0`. `act` is still used in all four files, so its import stays.
- `pnpm vitest run apps/desktop-companion/test/ui` → `27 passed`, `175 passed`.

### Step 6: Give the "checking" spinner its own test

In `apps/desktop-companion/test/ui/ReconSetupPage.test.ts`, insert this test between the end of "walks through the successful setup wizard" and the start of "supports retrying Claude detection after a failed check". Leave one blank line before and after it.

```ts
  it("shows the checking state while the skill file check is pending", async () => {
    let releaseSkillCheck!: (value: { found: boolean }) => void;
    const skillCheck = new Promise<{ found: boolean }>((resolve) => {
      releaseSkillCheck = resolve;
    });
    installTauriInternals(harness.dom.window, (cmd) => {
      switch (cmd) {
        case "check_claude_binary":
          return { found: true, version: "1.0.0" };
        case "credentials_list":
          return [];
        case "credentials_verify":
          return [
            { key: "ANTHROPIC_API_KEY", valid: true },
            { key: "DATAFORSEO_USERNAME", valid: true },
            { key: "DATAFORSEO_PASSWORD", valid: true },
            { key: "CRUX_API_KEY", valid: true },
          ];
        case "get_sync_status":
          return { version: "9.9.9" };
        case "check_skill_file":
          return skillCheck;
        default:
          return undefined;
      }
    });

    await mountReconSetup();
    await advanceThroughCredentials();
    await waitFor(
      () => harness.container.textContent?.includes("Checking skill file") === true,
      "the pending skill-file check spinner",
    );

    releaseSkillCheck({ found: true });
    await waitFor(() => harness.container.textContent?.includes("Recon Operator skill ready (v9.9.9)") === true);
  });
```

How it works: `check_skill_file` returns a promise the test controls. While it is pending the page must show the spinner, so the test can wait for it. Then the test releases the promise and waits for the final state. The strings in the `case` labels are command names and credential key names, not secrets.

**Verify**: `pnpm vitest run apps/desktop-companion/test/ui/ReconSetupPage.test.ts` → `6 passed`.

### Step 7: Run the full gates

- `pnpm typecheck` → no errors. This only confirms you did not touch `src/`.
- `pnpm vitest run apps/desktop-companion/test/ui` → `27 passed` files, `176 passed` tests.
- `pnpm coverage` → **N + 1** tests passed, and the `All files` row shows `100 | 100 | 100 | 100`.

**Verify**: all three match.

### Step 8 (optional): Stress check and cross-check

Skip this step if you are short on time; say in your report that you skipped it.

Stress check. This starts 30 busy processes for at most 5 minutes, then runs the full gate 10 times. Run it as one script from the repository root:

```bash
for i in $(seq 1 30); do node -e 'const e=Date.now()+300000;while(Date.now()<e){}' & done
sleep 1
fails=0
for i in $(seq 1 10); do
  pnpm coverage > "${TMPDIR:-/tmp}/stress-017-$i.log" 2>&1 || { fails=$((fails+1)); echo "run $i failed"; }
done
echo "failed=$fails/10"
kill $(jobs -p) 2>/dev/null
```

Expected: `failed=0/10`. If a run fails, open its log, find the failing test or the uncovered lines, and report them. Do not try to fix a new failure; that is a STOP condition.

Cross-check, only if the branch exists: `git diff probe/017-flaky-ui-tests -- apps/desktop-companion/test/ui` should print nothing.

## Test plan

- **New test (Step 6)**: "shows the checking state while the skill file check is pending" in `ReconSetupPage.test.ts`. It follows the pattern of the first test in the same file, with one command returning a promise the test holds.
- **No other new tests.** Steps 2–5 change how existing tests wait, not what they assert.
- **Already checked on the prototype, so you do not need to repeat it**: with the new helper in place, stubbing `open` in `LocalSiteCard.tsx` made the three "open" tests fail with `Timed out after 3000ms waiting for invoke to be called 1 time(s); got 0`. Removing `setState("checking")` from `ReconSetup.tsx` made the new test fail with `Timed out after 3000ms waiting for the pending skill-file check spinner`. So the longer wait does not hide a real defect.

## Done criteria

All must hold:

- [ ] `grep -rn 'async function waitFor(' apps/desktop-companion/test/ui` prints exactly one line, in `pageTestUtils.ts`.
- [ ] `grep -c 'realSetTimeout' apps/desktop-companion/test/ui/pageTestUtils.ts` prints `2`.
- [ ] `grep -rnE 'i < (10|50|80)\b' apps/desktop-companion/test/ui` prints nothing.
- [ ] `git diff --stat <base>..HEAD` lists only the six test files in "Scope" (plus `plans/README.md` if you maintain it). `<base>` is the commit you cut your branch from.
- [ ] `git diff --stat <base>..HEAD -- apps/desktop-companion/src` prints nothing.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm vitest run apps/desktop-companion/test/ui` reports 27 files and 176 tests passed.
- [ ] `pnpm coverage` exits 0 with N + 1 tests and 100% on all four measures.

## STOP conditions

Stop and report, without improvising, if:

- Step 1 shows plan 008 has not landed.
- The drift check shows a change and the code quoted in "Current state" no longer matches.
- A test other than the known flaky ones fails in Step 1, or any test fails twice in a row at any step after Step 2.
- `pnpm typecheck` reports any error. You should not have changed anything it checks.
- You find a caller that passes a number as the second argument to `waitFor`.
- You believe a file under `src/`, a config file, or a file outside "Scope" must change.
- Coverage is below 100% after Step 7. Report the file and line numbers from the coverage table.
- The stress check in Step 8 fails.

## Maintenance notes

- **New UI tests must import `waitFor` from `pageTestUtils.ts`.** Do not write a loop that counts turns. A count is not a time budget: how long one turn takes depends on the machine and on whether the test replaced `setTimeout`.
- **A wait helper must throw.** `waitForInvokeCount` used to return silently, so the failure showed up one assertion later and then again in the next test. That made the cause hard to see.
- **A state that exists only between two awaits needs a test that holds the second await open.** Step 6 is the pattern. Coverage of such a state by accident is a coin flip.
- **What this plan does not do.** It does not audit the other pages for more states that are covered only by accident; one more may exist. It does not change the single `setTimeout(0)` pauses. It does not make the suite immune to load; it makes waits fail after 3 seconds, not after 2 milliseconds.
- **What the evidence does and does not show.** Clean runs: 20 of 20 full-suite runs under 30 busy processes on one 18-core Mac. That is not a CI runner. If CI still fails on a UI wait after this lands, the timeout message now names what was being waited for; start there.
- **In review, check** that nobody adds `retry` to the Vitest config to hide a flaky test, and that new waits on counters or call counts pass a description.
