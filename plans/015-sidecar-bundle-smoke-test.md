# Plan 015: An integration test starts the real sidecar bundle and checks what it registered

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Preconditions (run first)**. This plan was written on 2026-11-17 against
> pull request zivtech/joyus-desktop#5 at commit `54fb205`, which was NOT yet
> merged. It can only be executed after that pull request has merged.
> 1. `test -f apps/desktop-companion/src/sidecar/entry.ts && echo present` → must print `present`.
> 2. `grep -c 'src/sidecar/entry.ts' apps/desktop-companion/scripts/bundle-sidecar.mjs` → must print `1`.
> 3. `test -f apps/desktop-companion/test/contract/knownGaps.ts && echo present` → must print `present` (plan 014).
> If any check fails, STOP: a prerequisite has not landed.
>
> **Drift check**: compare the excerpts in "Current state" with the live
> files. `entry.ts` is quoted from the pull request; if the merged version
> differs in the parts quoted, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: LOW–MED (three lines of product code; the integration test in this plan has never been run, so its first run is its real verification)
- **Depends on**: pull request zivtech/joyus-desktop#5 merged; plans/007, plans/008, plans/014-ipc-contract-test.md
- **Category**: tests
- **Planned at**: commit `54fb205` (head of PR #5), 2026-11-17

## Why this matters

The desktop app is a Rust shell that starts a Node process, the "sidecar", from a single bundled file, `sidecar-main.mjs`. Every feature goes through it.

Until PR #5, nothing in the repository called the sidecar's start function, so the shipped bundle did nothing. All unit tests passed and coverage was 100% the whole time, because every test builds the sidecar from mocked parts. PR #5 adds the real entry point, `entry.ts`, and excludes it from coverage. So the one file that decides whether the app works is still the one file no test runs.

There is a second gap that only a running process can show. A sidecar method can exist in the source and still never be registered in production, because the function that registers it is never called from the real entry point. The name-comparison test from plan 014 cannot see that: it reads source text.

After this plan, `pnpm test:integration` (already part of CI) builds the bundle with the real build script, copies it to an empty directory the way an installed app would have it, starts it under a throwaway home directory, and checks that it answers, that it lists its registered methods, that every method the Rust shell requests is really there, and that it exits cleanly.

## Current state

### How the bundle is built

`apps/desktop-companion/scripts/bundle-sidecar.mjs` (after PR #5), run from `apps/desktop-companion`:

```js
import { build } from "esbuild";

await build({
  entryPoints: ["src/sidecar/entry.ts"],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  outfile: "binaries/sidecar-main.mjs",
  banner: { js: "#!/usr/bin/env node" },
});
```

`binaries/sidecar-main.mjs` is ignored by git.

### The entry point (from PR #5)

`apps/desktop-companion/src/sidecar/entry.ts`. The parts that matter for a test:

```ts
const joyusDir = join(homedir(), ".joyus");
const manifestPath = join(joyusDir, "servers.json");
// ...
await mkdir(joyusDir, { recursive: true });

startSidecar({
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  exit: (code) => process.exit(code),
  onSignal: (signal, handler) => {
    process.on(signal, handler);
  },
  // ...
```

Everything it writes goes under the home directory (`~/.joyus/`, and the session database at `~/.joyus/session-manager.db`). `os.homedir()` follows the `HOME` environment variable, so a test can redirect all of it. With no `~/.joyus/servers.json`, no MCP server is started.

`startSidecar` also reads `JOYUS_MANAGED_TOOLING_MANIFEST_URL` and `SKILL_SYNC_REPO_URL` from the environment and starts network polling when both are set. The test must not pass them through.

### The protocol

One JSON object per line on stdin and stdout (JSON-RPC 2.0). `apps/desktop-companion/src/sidecar/ipc-handler.ts`:

```ts
export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;
```

```ts
export function createIpcHandler(writeFn: WriteFn): IpcHandler {
  const methods = new Map<string, MethodHandler>();

  async function handleRequest(raw: string): Promise<string> {
    // ... parse and validate ...
    const handler = methods.get(parsed.method);
    if (!handler) {
      return JSON.stringify(
        makeErrorResponse(
          parsed.id,
          JSON_RPC_ERRORS.METHOD_NOT_FOUND,
          "Method not found",
        ),
      );
    }
```

A request is `{"jsonrpc":"2.0","id":1,"method":"health.check","params":{}}`. A success response has `result`; a failure has `error: { code, message }`. Notifications from the sidecar have a `method` and no `id`.

The health method (`src/sidecar/services.ts`):

```ts
  ipc.registerMethod("health.check", async () => {
    return { ok: true, uptime_ms: nowFn() - startTime };
  });
```

On `SIGTERM`, `startSidecar` stops its services and calls `exit(0)`.

There is no way to ask a running sidecar which methods it has. Calling each method to find out is unsafe: some have side effects (`github-auth.start` opens a login flow).

### Test conventions

- Integration tests are named `*.integration.test.ts` and run with `pnpm test:integration` (`vitest.integration.config.ts` includes `apps/**/test/**/*.integration.test.ts`). They are excluded from the unit run and from coverage. The existing example is `apps/desktop-companion/test/controlPlaneWiring.integration.test.ts`, which also spawns a child process.
- Unit tests for the handler are in `apps/desktop-companion/test/sidecar/ipc-handler.test.ts`, in this style:

```ts
    it("returns correct response for valid request", async () => {
      const writeFn = vi.fn();
      const ipc = createIpcHandler(writeFn);

      ipc.registerMethod("echo", async (params) => params);

      const raw = JSON.stringify({
        jsonrpc: "2.0",
        method: "echo",
        params: { hello: "world" },
        id: 1,
      });

      const result = parseResponse(await ipc.handleRequest(raw));
```

- From plan 014, `apps/desktop-companion/test/contract/knownGaps.ts` exports `RUST_REQUESTS_WITHOUT_SIDECAR_METHOD`: the methods the Rust shell requests that no sidecar source file registers.

Repo conventions: TypeScript strict. Vitest. Unit coverage must stay at 100%, so the new product lines in Step 1 need the unit test in Step 1.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Handler unit tests | `pnpm vitest run apps/desktop-companion/test/sidecar/ipc-handler.test.ts` | all pass |
| Integration tests | `pnpm test:integration` | all pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Full coverage gate | `pnpm coverage` | exit 0, thresholds met |

Never run `pnpm ci` (that is clean-install in pnpm). The full pipeline is `pnpm run ci`.

## Scope

**In scope** (the only files you should create or modify):
- `apps/desktop-companion/src/sidecar/ipc-handler.ts` (one constant, one built-in method)
- `apps/desktop-companion/test/sidecar/ipc-handler.test.ts` (one test)
- `apps/desktop-companion/test/sidecarBundle.integration.test.ts` (create)
- `apps/desktop-companion/test/contract/knownGaps.ts` (one new export)
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch, even though they look related):
- `entry.ts`, `main.ts`, `services.ts`. If the smoke test shows that a method is missing at run time, record it in the allowlist (Step 3) and report it. Do not wire it up in this plan.
- `vitest.config.ts`. `entry.ts` stays excluded from unit coverage; this integration test is what exercises it.
- `scripts/bundle-sidecar.mjs`. The test must call the real script as it is.
- The Rust shell. Starting the sidecar through Tauri is not covered here.

## Git workflow

- Branch: `test/015-sidecar-smoke`
- Two commits: (1) `feat: let a running sidecar list its registered methods`, (2) `test: start the real sidecar bundle in an integration test`. Conventional commits, matching `git log`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Let the sidecar report its methods

In `apps/desktop-companion/src/sidecar/ipc-handler.ts`:

1. Directly below the `JSON_RPC_ERRORS` constant, add:

```ts
/** Built-in method: returns the sorted names of every registered method. */
export const LIST_METHODS = "rpc.listMethods";
```

2. In `createIpcHandler`, directly below `const methods = new Map<string, MethodHandler>();`, add:

```ts
  // Lets a test (or the Rust shell) ask a running sidecar what it registered.
  methods.set(LIST_METHODS, async () => [...methods.keys()].sort());
```

In `apps/desktop-companion/test/sidecar/ipc-handler.test.ts`, add `LIST_METHODS` to the import from `../../src/sidecar/ipc-handler`, and add this test at the end of `describe("registerMethod")`:

```ts
    it("lists registered methods, including the built-in, in sorted order", async () => {
      const ipc = createIpcHandler(vi.fn());
      ipc.registerMethod("zeta.last", async () => null);
      ipc.registerMethod("alpha.first", async () => null);

      const raw = JSON.stringify({ jsonrpc: "2.0", method: LIST_METHODS, id: 7 });
      const response = parseResponse(await ipc.handleRequest(raw));

      expect(response).toEqual({
        jsonrpc: "2.0",
        id: 7,
        result: ["alpha.first", "rpc.listMethods", "zeta.last"],
      });
    });
```

**Verify**: `pnpm vitest run apps/desktop-companion/test/sidecar/ipc-handler.test.ts` → all pass. `pnpm typecheck` → exit 0. Commit (commit 1).

### Step 2: Write the smoke test

Create `apps/desktop-companion/test/sidecarBundle.integration.test.ts`:

```ts
/**
 * Smoke test: builds the sidecar with the real build script, copies the one
 * output file to an empty directory (as in an installed app), starts it under
 * a throwaway home directory, and talks to it over stdin/stdout.
 */
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  RUST_REQUESTS_WITHOUT_SIDECAR_METHOD,
  SIDECAR_METHODS_NOT_REGISTERED_AT_RUNTIME,
} from "./contract/knownGaps";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REQUEST_TIMEOUT_MS = 10_000;

interface RpcMessage {
  id?: number | string | null;
  method?: string;
  result?: unknown;
  error?: { code: number; message: string };
}

let workDir = "";
let child: ChildProcessWithoutNullStreams | undefined;
let stderrText = "";
let nextId = 1;
const pending = new Map<number, (message: RpcMessage) => void>();
let exitCode: Promise<number | null> = Promise.resolve(null);

function request(method: string, params: unknown = {}): Promise<RpcMessage> {
  const id = nextId++;
  return new Promise<RpcMessage>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`no response to ${method} within ${REQUEST_TIMEOUT_MS} ms; stderr: ${stderrText}`));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolvePromise(message);
    });
    child?.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

/** Method names the Rust shell sends to the sidecar, read from the Rust source. */
function readRustRequests(): Set<string> {
  const names = new Set<string>();
  const rustDir = join(APP_ROOT, "src-tauri", "src");
  for (const name of readdirSync(rustDir)) {
    const fullPath = join(rustDir, name);
    if (!name.endsWith(".rs") || statSync(fullPath).isDirectory()) continue;
    for (const match of readFileSync(fullPath, "utf8").matchAll(/send_request\(\s*"([A-Za-z][\w.-]*)"/g)) {
      if (match[1] !== undefined) names.add(match[1]);
    }
  }
  return names;
}

beforeAll(() => {
  // 1. Build with the real script, exactly as the desktop build does.
  const build = spawnSync(process.execPath, ["scripts/bundle-sidecar.mjs"], {
    cwd: APP_ROOT,
    encoding: "utf8",
  });
  expect(build.status, `bundle-sidecar.mjs failed: ${build.stderr}`).toBe(0);

  // 2. Copy the single output file somewhere with no node_modules above it.
  workDir = mkdtempSync(join(tmpdir(), "sidecar-smoke-"));
  const homeDir = join(workDir, "home");
  mkdirSync(homeDir);
  const bundlePath = join(workDir, "sidecar-main.mjs");
  copyFileSync(join(APP_ROOT, "binaries", "sidecar-main.mjs"), bundlePath);

  // 3. Start it with a minimal environment: a throwaway home, and none of the
  //    JOYUS_* / SKILL_SYNC_* variables that would start network polling.
  child = spawn(process.execPath, [bundlePath], {
    cwd: workDir,
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: homeDir,
      USERPROFILE: homeDir,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const started = child;
  exitCode = new Promise((resolvePromise) => {
    started.on("exit", (code) => resolvePromise(code));
  });
  // If the process has already exited, writes fail; the request timeout reports it.
  started.stdin.on("error", () => undefined);
  started.stderr.on("data", (chunk: Buffer) => {
    stderrText += chunk.toString("utf8");
  });
  createInterface({ input: started.stdout }).on("line", (line) => {
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      return; // not a protocol line
    }
    if (typeof message.id === "number") {
      const resolvePending = pending.get(message.id);
      pending.delete(message.id);
      resolvePending?.(message);
    }
  });
}, 120_000);

afterAll(() => {
  child?.kill("SIGKILL");
  if (workDir !== "") {
    rmSync(workDir, { recursive: true, force: true });
  }
});

describe("bundled sidecar", () => {
  it("starts and answers health.check", async () => {
    const response = await request("health.check");

    expect(response.error).toBeUndefined();
    expect(response.result).toMatchObject({ ok: true });
  });

  it("answers an unknown method with METHOD_NOT_FOUND", async () => {
    const response = await request("no.such.method");

    expect(response.error?.code).toBe(-32601);
  });

  it("has registered every method the Rust shell requests, except the known gaps", async () => {
    const response = await request("rpc.listMethods");
    const live = new Set(response.result as string[]);
    expect(live.size).toBeGreaterThanOrEqual(20);

    const rustRequests = readRustRequests();
    expect(rustRequests.size).toBeGreaterThanOrEqual(30);

    const missing = [...rustRequests].filter((name) => !live.has(name)).sort();
    const expected = [
      ...RUST_REQUESTS_WITHOUT_SIDECAR_METHOD,
      ...SIDECAR_METHODS_NOT_REGISTERED_AT_RUNTIME,
    ].sort();

    expect(missing).toEqual(expected);
  });

  it.skipIf(process.platform === "win32")("exits with code 0 on SIGTERM and reports no fatal error", async () => {
    child?.kill("SIGTERM");

    const code = await Promise.race([
      exitCode,
      new Promise<string>((resolvePromise) => setTimeout(() => resolvePromise("timeout"), 15_000)),
    ]);

    expect(code).toBe(0);
    expect(stderrText).not.toContain("Fatal error");
  }, 20_000);
});
```

The four tests run in order and share one process. The SIGTERM test is last on purpose.

In `apps/desktop-companion/test/contract/knownGaps.ts`, append:

```ts
/**
 * Methods the Rust shell requests that DO appear in a registerMethod call in
 * the sidecar source, but that the running sidecar does not register, because
 * the function that registers them is never called from the real entry point.
 * Found by the bundle smoke test. Sorted. Same rules as above: never add a
 * name to make a test pass; delete a name when you wire it up.
 */
export const SIDECAR_METHODS_NOT_REGISTERED_AT_RUNTIME: readonly string[] = [];
```

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: First run, and filling in the run-time gaps

Run `pnpm test:integration`.

- **Tests 1, 2 and 4 must pass as written.** If one fails, STOP (see STOP conditions). Include the test's error text, which contains the sidecar's stderr.
- **Test 3 is expected to fail on the first run**, because the list you just added is empty. Vitest prints `Expected` and `Received`. Every name in `Received` that is not in `Expected` is a method the Rust shell calls that the live sidecar does not have. Add exactly those names to `SIDECAR_METHODS_NOT_REGISTERED_AT_RUNTIME`, sorted. When this plan was written, `sync.status` and `sync.trigger` were expected to be there (the function `registerSyncMethods` has no production caller). List every name you add in your final report under "run-time gaps found".
- If a name is in `Expected` but not in `Received`, a gap from plan 014's list has been fixed since. Remove it from the list it is in.

Rerun `pnpm test:integration` until all four pass.

**Verify**: `pnpm test:integration` → all pass, including the four new tests. Run it a second time to confirm it is repeatable.

### Step 4: Prove the test can fail

Temporary edit; revert it afterward. In `apps/desktop-companion/scripts/bundle-sidecar.mjs`, change the entry point from `src/sidecar/entry.ts` to `src/sidecar/main.ts` (the pre-PR-#5 state, a module that only exports a function). Run `pnpm test:integration`.

**Expected**: the suite fails, starting with "starts and answers health.check" (a timeout, because that module starts nothing). Restore the file.

**Verify**: `git diff --stat -- apps/desktop-companion/scripts/bundle-sidecar.mjs` prints nothing, and `pnpm test:integration` passes again.

### Step 5: Run the full gates

Run `pnpm typecheck`, `pnpm coverage`, and `pnpm test:integration`.

**Verify**: all exit 0. `ipc-handler.ts` is at 100% in the coverage summary. Commit (commit 2).

## Test plan

- One new unit test for `rpc.listMethods` in `ipc-handler.test.ts`.
- Four new integration tests in `sidecarBundle.integration.test.ts`: the bundle starts and answers; unknown methods are rejected; the live method list covers what the Rust shell requests, minus two explicit allowlists; clean exit on SIGTERM with no fatal error on stderr.
- Step 4 is the test of the test: with the old entry point the suite must fail.
- Verification: `pnpm test:integration` → all pass, twice in a row.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm coverage` exits 0
- [ ] `pnpm test:integration` exits 0, twice in a row
- [ ] `grep -c 'rpc.listMethods' apps/desktop-companion/src/sidecar/ipc-handler.ts` prints 1
- [ ] `grep -c 'SIDECAR_METHODS_NOT_REGISTERED_AT_RUNTIME' apps/desktop-companion/test/contract/knownGaps.ts` prints 1
- [ ] `git diff --stat main..HEAD -- apps/desktop-companion/scripts apps/desktop-companion/src/sidecar/entry.ts apps/desktop-companion/src/sidecar/main.ts vitest.config.ts` prints nothing
- [ ] No directory named `.joyus` was created in your real home directory by the test: compare `ls -la ~/.joyus 2>/dev/null` before Step 3 and after Step 5
- [ ] Your report lists the run-time gaps found in Step 3
- [ ] `plans/README.md` status row for 015 updated

## STOP conditions

Stop and report back (do not improvise) if:

- A precondition at the top fails.
- "starts and answers health.check" fails after a correct build. The shipped sidecar does not start. Report the full error, including stderr. This is the most important thing this test can find; do not work around it.
- stderr contains `Fatal error` during a normal run.
- The SIGTERM test reports a non-zero exit code or `"timeout"`. The sidecar does not shut down cleanly. Report it; do not raise the timeout past 15 seconds or change the assertion.
- More than 6 names have to be added in Step 3. Report the list.
- The bundle fails to start only when copied out of the repository (for example "Cannot find package"). That means the bundle depends on files that are not shipped with it. Report the missing module name.
- `~/.joyus` in your real home directory changed during the run.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- This test starts the sidecar directly with Node. It does not prove that the Rust shell finds the bundle and the Node binary inside an installed app; that path (`sidecar.rs`) is still untested.
- `rpc.listMethods` is available to the Rust shell too. A useful follow-up is to call it once at startup and log any method the shell expects but the sidecar lacks.
- The Rust request extraction here is a copy of one regular expression from `test/contract/ipcContract.test.ts`. If the Rust call style changes, update both. The `>= 30` floor fails if the pattern stops matching.
- Review notes on PR #5's `entry.ts` that this plan does not fix: a server command that cannot be started emits an `error` event with no listener, which the sidecar treats as fatal and exits; and a failed start reports its process id as `-1`, a value that must never reach `process.kill`. They are recorded in `plans/README.md`.
- Reviewer focus: the test must run the copied bundle, not the one inside the repository, and must not pass the developer's environment through.
