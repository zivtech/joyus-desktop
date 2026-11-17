# Plan 010: A recon engagement can never be the engagements root, and stored ZIP entries are tested

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat cea62f6..HEAD -- apps/desktop-companion/src/sidecar/recon.ts apps/desktop-companion/test/sidecar/recon.test.ts`
> Both files WILL show changes, because plan 008 must land before this one.
> That is expected. What must still match is the code quoted in "Current
> state" below (`slugify`, `isWithinPath`, and the two `v8 ignore` lines);
> plan 008 does not touch those. On a mismatch there, treat it as a STOP
> condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/007-correct-agent-and-contributor-docs.md, plans/008-make-recon-tests-hermetic.md
- **Category**: bug, security
- **Planned at**: commit `cea62f6`, 2026-11-17

## Why this matters

Recon stores each client's engagement files in `<root>/<client-slug>`, where the root is `~/Documents/joyus-recon-engagements`. The slug is the client name reduced to `a-z`, `0-9` and hyphens. Three inputs break that layout:

1. **A name with no ASCII letters or digits** (`"!!!"`, `"日本電気"`) produces an empty slug. The engagement directory then IS the root. Scanning or exporting that engagement scans and zips every client's files into one archive, and writes it to `~/Documents/exports/`.
2. **A client called "Exports"** gets the slug `exports`. Export archives for every client are written to `<root>/exports/`, so this client's directory is the shared archive folder. Exporting it ships every other client's archive.
3. **The scan and export handlers accept the root itself** as an engagement directory, so the same leak is reachable from any caller that passes the root.

This is a confidentiality bug in a tool whose output goes to clients.

A fourth, smaller gap sits in the same file. The hand-rolled ZIP writer stores a file uncompressed when compression would not shrink it. That branch is excluded from coverage with a `v8 ignore` comment and has no test. Every empty file and every very small file takes that branch, so it runs in normal use.

After this plan: an unusable or reserved slug falls back to `client-<8 hex digits>`, the root is rejected as an engagement directory, and the stored-entry branch is covered by tests that read the archive bytes.

## Current state

Files:

- `apps/desktop-companion/src/sidecar/recon.ts` — sidecar handlers `recon.create`, `recon.scan`, `recon.export`.
- `apps/desktop-companion/test/sidecar/recon.test.ts` — the tests. After plan 008 it has a fake home directory, a `pathExists()` helper, and every block that creates directories injects `{ engagementRoot: tmpRoot }`.

The imports at the top of `recon.ts` (lines 20–27). There is no `node:crypto` import yet:

```ts
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { IpcHandler } from "./ipc-handler";
import { autoSyncIfNeeded, checkVersion } from "./version-gate";
```

`slugify` (lines 90–99):

```ts
/**
 * Slugify a client name: lowercase, collapse non-alphanumeric runs to a
 * single hyphen, strip leading/trailing hyphens.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
```

`isWithinPath` and its only caller (lines 112–139). Note the first operand: an empty relative path means "candidate equals root", and it is accepted:

```ts
function isWithinPath(root: string, candidate: string): boolean {
  const relativePath = path.relative(root, candidate);
  return (
    relativePath === "" ||
    (relativePath !== "" &&
      !relativePath.startsWith("..") &&
      !path.isAbsolute(relativePath))
  );
}

async function resolveAllowedEngagementDir(
  engagementDir: string,
  deps: ReconRuntimeDeps,
): Promise<string> {
  const configuredRoot = deps.engagementRoot ?? defaultEngagementRoot();
  const [rootRealPath, engagementRealPath] = await Promise.all([
    fs.realpath(configuredRoot),
    fs.realpath(engagementDir),
  ]);

  if (!isWithinPath(rootRealPath, engagementRealPath)) {
    throw new Error(
      `recon: engagementDir must be under ${rootRealPath}`,
    );
  }

  return engagementRealPath;
}
```

How `recon.create` uses the slug (line 275 and, after plan 008, lines 290–293):

```ts
    const clientSlug = slugify(clientName);
    // ...
    const engagementId = `${clientSlug}-${datePart}-${timePart}`;

    const engagementDir = path.join(
      runtimeDeps.engagementRoot ?? defaultEngagementRoot(),
      clientSlug,
    );
```

Where export archives go (lines 403–406). `path.dirname(engagementDir)` is the root, so archives land in `<root>/exports/`:

```ts
    const engagementName = path.basename(engagementDir);
    const exportsDir = path.join(path.dirname(engagementDir), "exports");
    await fs.mkdir(exportsDir, { recursive: true });
    const zipPath = path.join(exportsDir, `${engagementName}.zip`);
```

The untested ZIP branch (lines 529–536):

```ts
    for (const [absPath, archivePath] of filePairs) {
      const fileData = await fs.readFile(absPath);
      const compressedData = deflateRawSync(fileData);

      // Use deflate if it's smaller, otherwise store raw
      const useDeflate = compressedData.length < fileData.length;
      const storedData = useDeflate ? compressedData : /* v8 ignore next */ fileData;
      const method = useDeflate ? 8 : /* v8 ignore next */ 0; // 8 = deflate, 0 = stored
```

Facts you can rely on (checked with Node 24 on 2026-11-17): `deflateRawSync` of a 1-byte buffer returns 3 bytes, and of an empty buffer returns 2 bytes. Both are "not smaller", so both files are stored with method 0.

The ZIP local file header this code writes, which the new tests read back:

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | signature `0x04034b50` |
| 8 | 2 | method (8 = deflate, 0 = stored) |
| 18 | 4 | stored (compressed) size |
| 22 | 4 | original size |
| 26 | 2 | file name length |
| 30 | name length | file name, then the file data |

The end-of-archive record is the last 22 bytes of the file; the total entry count is the 2-byte value at offset 10 inside it.

The test pattern to copy. This is the existing export block setup and one export test (`recon.test.ts`, `describe("recon.export")`):

```ts
describe("recon.export", () => {
  let ipc: InvokableMockIpc;
  let tmpRoot: string;
  let engagementDir: string;
  let spawnMock: MockInstance;

  beforeEach(async () => {
    ipc = makeIpc();
    tmpRoot = makeTempDir();
    registerReconMethods(ipc, undefined, { engagementRoot: tmpRoot });
    engagementDir = path.join(tmpRoot, "engagement");
    await mkdir(engagementDir, { recursive: true });
    spawnMock = await getSpawnMock();
  });

  // ...
  it("returns correct shape on a clean scan export", async () => {
    // Write a real file to the engagement dir so the ZIP is non-empty
    await writeFile(path.join(engagementDir, "notes.txt"), "recon notes here");

    const fakeChild = makeFakeChild();
    spawnMock.mockReturnValueOnce(fakeChild as unknown as ReturnType<SpawnFn>);

    const exportPromise = ipc._invoke("recon.export", { engagementDir });
    await waitForSpawn(spawnMock);
    resolveCleanChild(fakeChild);

    const result = (await exportPromise) as {
      zipPath: string;
      size: number;
      scanPassed: boolean;
      overridden?: boolean;
    };
```

The export handler runs a scan first by spawning a child process. `spawn` is mocked in this file; the three lines `makeFakeChild` / `mockReturnValueOnce` / `resolveCleanChild` make the scan pass. Every export test needs them.

The existing "outside the root" scan test, which the new "root itself" tests sit next to:

```ts
  it("rejects engagementDir outside the configured recon root", async () => {
    const outsideRoot = makeTempDir();
    const outsideEngagement = path.join(outsideRoot, "outside");
    await mkdir(outsideEngagement, { recursive: true });

    try {
      await expect(
        ipc._invoke("recon.scan", { engagementDir: outsideEngagement }),
      ).rejects.toThrow("engagementDir must be under");
    } finally {
      removeTempDir(outsideRoot);
    }
  });
```

The test file already imports `readFile`, `writeFile` and `mkdir` from `node:fs/promises`. `readFile` with no encoding returns a `Buffer`.

Repo conventions: TypeScript strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Vitest. Coverage must stay at 100% lines, functions, branches and statements.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Recon tests only | `pnpm vitest run apps/desktop-companion/test/sidecar/recon.test.ts` | all pass |
| Full coverage gate | `pnpm coverage` | exit 0, thresholds met |

Never run `pnpm ci` (that is clean-install in pnpm). The full pipeline is `pnpm run ci`.

Known flaky tests, unrelated to this plan: `apps/desktop-companion/test/ui/SessionsPage.test.ts` ("clears mode note timers…"), `apps/desktop-companion/test/ui/components/LocalSiteCard.test.ts`, and a timing-dependent coverage gap in `ReconSetup.tsx`. If `pnpm coverage` fails only in one of those, rerun it once. If it fails again, treat it as a STOP condition.

## Scope

**In scope** (the only files you should modify):
- `apps/desktop-companion/src/sidecar/recon.ts`
- `apps/desktop-companion/test/sidecar/recon.test.ts`
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch, even though they look related):
- The on-disk layout. Engagements stay at `<root>/<client-slug>`. Moving to `<root>/<client-slug>/<engagement-id>` is a maintainer decision (D3 in `plans/README.md`) and is not part of this plan.
- Two different client names that reduce to the same slug (`"Acme Corp"` and `"Acme, Corp."`) still share one directory. Do not add a guard for that here. It is recorded as a known residual risk in `plans/README.md`.
- The `startsWith("..")` test in `isWithinPath`. It wrongly rejects a directory literally named `..foo`; that was reviewed and judged negligible.
- `apps/desktop-companion/src-tauri/src/recon.rs`. It receives the engagement directory from the UI and does not check it. That belongs to a later plan.
- The ZIP writer's in-memory buffering and 4 GB limit. Documented in the source as accepted.

## Git workflow

- Branch: `fix/010-recon-directory-safety`
- Three commits: (1) `fix: never use the engagements root as a recon engagement directory`, (2) `fix: reject the engagements root in recon scan and export`, (3) `test: cover stored ZIP entries in recon export`. Conventional commits, matching `git log`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Confirm plan 008 has landed

Run:

- `grep -c 'os.homedir()' apps/desktop-companion/src/sidecar/recon.ts` → must print `1`
- `grep -c 'realExistsSync' apps/desktop-companion/test/sidecar/recon.test.ts` → must print `0`
- `grep -c 'function pathExists' apps/desktop-companion/test/sidecar/recon.test.ts` → must print `1`

If any differs, STOP: plan 008 is not done, and running the recon tests could delete a real folder.

**Verify**: all three counts match.

### Step 2: Give `slugify` a safe fallback

In `recon.ts`:

1. Add this import directly above `import { promises as fs } from "node:fs";`:

```ts
import { createHash } from "node:crypto";
```

2. Replace the whole `slugify` function and its doc comment with:

```ts
/**
 * Directory names directly under the engagements root that the recon code
 * itself uses. A client slug must never equal one of them.
 * "exports" is where recon.export writes archives.
 */
const RESERVED_SLUGS: ReadonlySet<string> = new Set(["exports"]);

/**
 * Slugify a client name: lowercase, collapse non-alphanumeric runs to a
 * single hyphen, strip leading/trailing hyphens.
 *
 * A name with no ASCII letters or digits would give an empty slug, and the
 * engagement directory would then be the engagements root itself. Such a
 * name, and any reserved name, falls back to "client-" plus the first eight
 * hex digits of the SHA-256 of the name, so it is stable across runs.
 */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug !== "" && !RESERVED_SLUGS.has(slug)) {
    return slug;
  }
  const digest = createHash("sha256").update(name, "utf8").digest("hex").slice(0, 8);
  return `client-${digest}`;
}
```

Change nothing in the `recon.create` handler.

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Test the fallback

In `recon.test.ts`, at the end of `describe("slugify (via recon.create)")`, add these tests. They follow the four existing tests in that block, which call `recon.create` and read `clientSlug` from the result.

```ts
  it("falls back to a hashed slug when the name has no ASCII letters or digits", async () => {
    const result = (await ipc._invoke("recon.create", {
      clientName: "!!!",
      url: "https://symbols.example.com",
      accessMode: "rfp",
    })) as { clientSlug: string; engagementDir: string; engagementId: string };

    expect(result.clientSlug).toBe("client-e84c538e");
    // The engagement directory is a child of the root, never the root itself.
    expect(result.engagementDir).toBe(path.join(tmpRoot, "client-e84c538e"));
    expect(result.engagementId.startsWith("client-e84c538e-")).toBe(true);
  });

  it("falls back to a hashed slug for a non-Latin name", async () => {
    const result = (await ipc._invoke("recon.create", {
      clientName: "日本電気",
      url: "https://nec.example.com",
      accessMode: "rfp",
    })) as { clientSlug: string };

    expect(result.clientSlug).toBe("client-944e0446");
  });

  it("gives different symbol-only names different slugs", async () => {
    const first = (await ipc._invoke("recon.create", {
      clientName: "!!!",
      url: "https://a.example.com",
      accessMode: "rfp",
    })) as { clientSlug: string };
    const second = (await ipc._invoke("recon.create", {
      clientName: "???",
      url: "https://b.example.com",
      accessMode: "rfp",
    })) as { clientSlug: string };

    expect(second.clientSlug).toBe("client-a03b221c");
    expect(second.clientSlug).not.toBe(first.clientSlug);
  });

  it("does not use the reserved exports directory as a client slug", async () => {
    const result = (await ipc._invoke("recon.create", {
      clientName: "Exports",
      url: "https://exports.example.com",
      accessMode: "rfp",
    })) as { clientSlug: string; engagementDir: string };

    expect(result.clientSlug).toBe("client-2f4dcf59");
    expect(path.basename(result.engagementDir)).not.toBe("exports");
  });
```

The hash values are the first eight hex digits of SHA-256 of the exact client name. To check one yourself: `node -e 'console.log(require("node:crypto").createHash("sha256").update("!!!","utf8").digest("hex").slice(0,8))'` prints `e84c538e`.

`tmpRoot` exists in this block after plan 008. If the variable has another name there, use that name.

**Verify**: `pnpm vitest run apps/desktop-companion/test/sidecar/recon.test.ts` → all pass, including the four new tests. Commit (commit 1).

### Step 4: Reject the root in scan and export

In `recon.ts`, replace the `isWithinPath` function with:

```ts
/**
 * True when `candidate` is strictly inside `root`. The root itself is not
 * "within" the root: an engagement directory must be a child directory.
 */
function isWithinPath(root: string, candidate: string): boolean {
  const relativePath = path.relative(root, candidate);
  return (
    relativePath !== "" &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  );
}
```

Do not change `resolveAllowedEngagementDir` or its error message.

Add one test to `describe("recon.scan")`, directly after "rejects engagementDir outside the configured recon root":

```ts
  it("rejects the engagement root itself as an engagementDir", async () => {
    await expect(
      ipc._invoke("recon.scan", { engagementDir: tmpRoot }),
    ).rejects.toThrow("engagementDir must be under");
  });
```

Add one test to `describe("recon.export")`, directly after "rejects missing engagementDir":

```ts
  it("rejects the engagement root itself as an engagementDir", async () => {
    await expect(
      ipc._invoke("recon.export", { engagementDir: tmpRoot }),
    ).rejects.toThrow("engagementDir must be under");
    // The scan must not have been started for a rejected directory.
    expect(spawnMock).not.toHaveBeenCalled();
  });
```

If `expect(spawnMock).not.toHaveBeenCalled()` fails because an earlier test's calls are still recorded on the mock, replace that one line with a call-count comparison: read `spawnMock.mock.calls.length` before the `await expect(...)` and assert it is unchanged after. Do not delete the check.

**Verify**: `pnpm vitest run apps/desktop-companion/test/sidecar/recon.test.ts` → all pass. Commit (commit 2).

### Step 5: Cover the stored ZIP branch

In `recon.ts`, remove the two `/* v8 ignore next */` comments on the `storedData` and `method` lines, so they read:

```ts
      const storedData = useDeflate ? compressedData : fileData;
      const method = useDeflate ? 8 : 0; // 8 = deflate, 0 = stored
```

Add two tests at the end of `describe("recon.export")`:

```ts
  it("stores a file that does not compress, byte for byte", async () => {
    // One byte deflates to three bytes, so the writer must store it raw.
    await writeFile(path.join(engagementDir, "one.txt"), "x");

    const fakeChild = makeFakeChild();
    spawnMock.mockReturnValueOnce(fakeChild as unknown as ReturnType<SpawnFn>);

    const exportPromise = ipc._invoke("recon.export", { engagementDir });
    await waitForSpawn(spawnMock);
    resolveCleanChild(fakeChild);
    const result = (await exportPromise) as { zipPath: string };

    const zip = await readFile(result.zipPath);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50); // local file header
    expect(zip.readUInt16LE(8)).toBe(0);          // method: stored
    expect(zip.readUInt32LE(18)).toBe(1);         // stored size
    expect(zip.readUInt32LE(22)).toBe(1);         // original size
    const nameLength = zip.readUInt16LE(26);
    expect(zip.subarray(30, 30 + nameLength).toString("utf8")).toBe(
      path.join("engagement", "one.txt"),
    );
    expect(zip.subarray(30 + nameLength, 30 + nameLength + 1).toString("utf8")).toBe("x");
  });

  it("stores an empty file as a zero-length entry", async () => {
    await writeFile(path.join(engagementDir, "empty.txt"), "");

    const fakeChild = makeFakeChild();
    spawnMock.mockReturnValueOnce(fakeChild as unknown as ReturnType<SpawnFn>);

    const exportPromise = ipc._invoke("recon.export", { engagementDir });
    await waitForSpawn(spawnMock);
    resolveCleanChild(fakeChild);
    const result = (await exportPromise) as { zipPath: string };

    const zip = await readFile(result.zipPath);
    expect(zip.readUInt16LE(8)).toBe(0);  // method: stored
    expect(zip.readUInt32LE(18)).toBe(0); // stored size
    expect(zip.readUInt32LE(22)).toBe(0); // original size
    // End-of-archive record is the last 22 bytes; total entries at offset 10.
    const eocd = zip.subarray(zip.length - 22);
    expect(eocd.readUInt32LE(0)).toBe(0x06054b50);
    expect(eocd.readUInt16LE(10)).toBe(1);
  });
```

Each test writes exactly one file, so that file's header is at byte 0 of the archive.

**Verify**: `pnpm vitest run apps/desktop-companion/test/sidecar/recon.test.ts` → all pass. `grep -c 'v8 ignore' apps/desktop-companion/src/sidecar/recon.ts` → `2` (the two that remain are the `String(err)` fallbacks in `recon.create`; leave them). Commit (commit 3).

### Step 6: Run the full gates

Run `pnpm typecheck`, then `pnpm coverage`.

**Verify**: both exit 0 and the coverage summary shows 100% for `recon.ts`.

## Test plan

- Four new tests in `describe("slugify (via recon.create)")`: symbol-only name, non-Latin name, two symbol-only names differ, reserved name `Exports`.
- One new test each in `describe("recon.scan")` and `describe("recon.export")`: the root itself is rejected.
- Two new tests in `describe("recon.export")` that parse the archive bytes: a 1-byte file and an empty file are stored with method 0.
- Structural pattern: the existing tests in each of those blocks, quoted in "Current state".
- Verification: `pnpm vitest run apps/desktop-companion/test/sidecar/recon.test.ts` → all pass (8 more tests than before this plan).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm vitest run apps/desktop-companion/test/sidecar/recon.test.ts` exits 0
- [ ] `pnpm coverage` exits 0
- [ ] `grep -c 'relativePath === ""' apps/desktop-companion/src/sidecar/recon.ts` prints 0
- [ ] `grep -c 'RESERVED_SLUGS' apps/desktop-companion/src/sidecar/recon.ts` prints 2
- [ ] `grep -c 'v8 ignore' apps/desktop-companion/src/sidecar/recon.ts` prints 2
- [ ] `grep -c 'client-e84c538e' apps/desktop-companion/test/sidecar/recon.test.ts` prints 3 or more
- [ ] `git status --short` lists only the two in-scope source files and `plans/README.md`
- [ ] `plans/README.md` status row for 010 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1 shows plan 008 has not landed.
- The code at the locations in "Current state" does not match the excerpts (other than the `recon.create` path lines that plan 008 changes).
- A hash in Step 3 does not match what the `node -e` check prints on your machine. Report both values; do not edit the expected value to make the test pass.
- An existing test fails after Step 4. That would mean some caller passes the root as an engagement directory on purpose. Report which test; do not put the `relativePath === ""` case back.
- One of the byte-level assertions in Step 5 fails. The ZIP writer may be producing a corrupt stored entry. Report the actual values; do not weaken the assertion or restore the `v8 ignore` comments.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- Any new directory the recon code creates directly under the engagements root must be added to `RESERVED_SLUGS`, or a client with that name will share it.
- Still open after this plan, by decision D3: all engagements for one client share one directory, and two client names with the same slug share one directory. Files from an earlier engagement are included in a later export. The fix is a layout change (`<root>/<slug>/<engagement-id>`), which also changes what the Rust shell and existing users see on disk.
- The Rust command `launch_recon` (`apps/desktop-companion/src-tauri/src/recon.rs`) takes `engagement_dir` from the UI and runs the `claude` CLI there without checking that it is under the engagements root. The containment check exists only in the sidecar.
- Reviewer focus: the fallback must be deterministic (same name, same slug), and the `recon.export` root test must prove no scan was spawned.
