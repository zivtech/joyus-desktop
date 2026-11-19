# Plan 011: CI compiles the Rust shell on every pull request, production advisories are cleared, and updates are automated

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat cea62f6..HEAD -- .github/workflows/ci.yml apps/desktop-companion/package.json apps/desktop-companion/src-tauri/Cargo.toml`
> If any of those changed since this plan was written, compare the
> "Current state" excerpts against the live files before proceeding; on a
> mismatch, treat it as a STOP condition. `pnpm-lock.yaml` is expected to
> have changed if other work has merged; that alone is not a mismatch.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (Part A adds a CI job that has never run; its first run on a pull request is the real test)
- **Depends on**: plans/007-correct-agent-and-contributor-docs.md, plans/008-make-recon-tests-hermetic.md
- **Category**: dx, dependencies, security
- **Planned at**: commit `cea62f6`, 2026-11-17

## Why this matters

The desktop app has a Rust shell (`apps/desktop-companion/src-tauri`, 8 source files). The CI workflow that gates pull requests never compiles it. Rust is compiled only by `build-desktop.yml`, which runs after a merge to `main`. A pull request that breaks the Rust build shows a green check and breaks `main`. An open pull request (zivtech/joyus-desktop#5) changes three Rust files and has a green check that says nothing about them.

Separately, `pnpm audit --prod` on 2026-11-17 reported 12 advisories in shipped code, all in `react-router` 7.13.1 (6 high). The build script that unpacks the bundled Node.js runtime uses `tar` 7.5.15, which has a critical advisory. Nothing in the repo proposes dependency updates, so these stay until someone looks.

After this plan: every pull request compiles the Rust shell and runs its tests, the production advisories are gone, and Dependabot opens grouped weekly update pull requests that the new CI job can check.

## Current state

### The pull-request workflow

`.github/workflows/ci.yml` in full (41 lines). It has one job, on Linux, with no Rust step:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10.5.2

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm

      - name: Install
        run: pnpm install --frozen-lockfile

      - name: Typecheck
        run: pnpm typecheck

      - name: Coverage (must meet 100% thresholds)
        run: pnpm coverage

      - name: Integration tests
        run: pnpm test:integration

      - name: Upload coverage artifact
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: coverage-lcov
          path: coverage/lcov.info
```

### What the Rust build needs before it can compile

`apps/desktop-companion/src-tauri/tauri.conf.json` references three build outputs that are not in git. The Tauri build script fails if they are missing:

```json
  "build": {
    "beforeBuildCommand": "pnpm --filter @joyus/desktop-companion run build:frontend",
    "frontendDist": "../dist-ui"
  },
  ...
    "externalBin": ["../binaries/node"],
    "resources": ["../binaries/sidecar-main.mjs", "../resources/scan-sensitive-output.mjs"],
```

| Needed path (under `apps/desktop-companion/`) | Produced by | In git? |
|---|---|---|
| `dist-ui/` | `pnpm --filter @joyus/desktop-companion run build:frontend` (runs `vite build`) | no (`.gitignore`: `dist-ui/`) |
| `binaries/sidecar-main.mjs` | `node scripts/bundle-sidecar.mjs`, run from `apps/desktop-companion` | no |
| `binaries/node-<target-triple>` | `node scripts/download-node.mjs`, run from `apps/desktop-companion` | no |
| `resources/scan-sensitive-output.mjs` | — | yes |

`build-desktop.yml` already runs the two scripts in this order, on `macos-latest`. Copy its pattern:

```yaml
      - name: Install Rust toolchain
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.rust-targets }}
      ...
      - name: Bundle sidecar
        working-directory: apps/desktop-companion
        run: node scripts/bundle-sidecar.mjs

      - name: Download Node.js sidecar binary
        working-directory: apps/desktop-companion
        run: node scripts/download-node.mjs
```

`apps/desktop-companion/src-tauri/Cargo.lock` is committed. The crate has no `#[test]` functions today, so `cargo test` compiles everything and reports zero tests. Later plans add Rust tests; this job is where they will run.

Why macOS and not Linux: `main` supports macOS and Windows only (`"targets": ["dmg", "nsis"]`). Compiling Tauri on Linux needs extra system packages, and Linux support is still in an unmerged pull request.

### The dependencies

`apps/desktop-companion/package.json`, the two lines this plan changes:

```json
  "dependencies": {
    ...
    "react-router-dom": "^7.13.1",
    ...
  },
  "devDependencies": {
    ...
    "tar": "^7.4.3",
    ...
  }
```

`pnpm-lock.yaml` resolves them to `react-router-dom@7.13.1`, `react-router@7.13.1` and `tar@7.5.15`.

Advisory data from `pnpm audit` on 2026-11-17:

| Package | Installed | Advisories | Highest patched version named |
|---|---|---|---|
| `react-router` (via `react-router-dom`) | 7.13.1 | 12 (6 high, 5 moderate, 1 low) | `>=7.18.2` |
| `tar` | 7.5.15 | 4 distinct (1 critical, 1 high, 2 moderate) | `>=7.5.19` |

`react-router-dom` is imported in six UI files (`App.tsx`, `components/Layout.tsx`, and four pages), using only `MemoryRouter`, `Route`, `Routes`, `NavLink`, `Outlet` and `useNavigate`.

`tar` is used in one place, `apps/desktop-companion/scripts/download-node.mjs`:

```js
import { extract as tarExtract } from "tar";
...
async function extractTarGz(archivePath, outputDir) {
  await tarExtract({ file: archivePath, cwd: outputDir });
}
```

There is no `.github/dependabot.yml`. `.github/` contains `CODEOWNERS`, `scripts/` and `workflows/` (`build-desktop.yml`, `ci.yml`, `desktop-release.yml`).

Repo conventions: pnpm 10.5.2 workspaces, Node 24. Quality gates are `pnpm typecheck`, `pnpm coverage` (100% thresholds) and `pnpm test:integration`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Full coverage gate | `pnpm coverage` | exit 0, thresholds met |
| Integration tests | `pnpm test:integration` | exit 0 |
| Production advisories | `pnpm audit --prod` | "No known vulnerabilities found" |
| Rust build and tests | `cargo test --locked` (run in `apps/desktop-companion/src-tauri`) | exit 0, `test result: ok` |

Never run `pnpm ci` (that is clean-install in pnpm). The full pipeline is `pnpm run ci`.

This plan needs network access for `pnpm add` and `pnpm audit`.

Known flaky tests, unrelated to this plan: `apps/desktop-companion/test/ui/SessionsPage.test.ts` ("clears mode note timers…"), `apps/desktop-companion/test/ui/components/LocalSiteCard.test.ts`, and a timing-dependent coverage gap in `ReconSetup.tsx`. If `pnpm coverage` fails only in one of those, rerun it once. If it fails again, treat it as a STOP condition.

## Scope

**In scope** (the only files you should create or modify):
- `.github/workflows/ci.yml`
- `.github/dependabot.yml` (create)
- `apps/desktop-companion/package.json` (two version ranges)
- `pnpm-lock.yaml` (only through `pnpm add`)
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch, even though they look related):
- `apps/desktop-companion/src-tauri/Cargo.toml` and the `keyring` dependency. The keychain is compiled without a platform backend. Do NOT add `apple-native` or any other `keyring` feature. Turning the backend on activates a startup migration that deletes the credentials file the rest of the app still reads. That finding is waiting on a maintainer decision (D8 in `plans/README.md`).
- Any `.rs` file. `cargo` prints one warning today (`unused import: Emitter` in `src/tray.rs`). Leave it; do not add `-D warnings` or `clippy` to the job.
- `vitest`, `@vitest/coverage-v8`, `vite` and the other development-only advisories. Dependabot will propose those one group at a time, where CI can check each. Upgrading the coverage tool inside this plan risks moving the 100% gate for unrelated reasons.
- `.github/workflows/build-desktop.yml` and `desktop-release.yml`.
- `apps/desktop-companion/scripts/download-node.mjs`. It downloads Node.js without checking a checksum. A later plan covers that.
- Adding ESLint or any linter. Considered and left out: strict TypeScript already runs, and a first lint pass over this codebase would be a large unrelated diff.

## Git workflow

- Branch: `chore/011-rust-ci-and-dependencies`
- Three commits: (1) `ci: compile and test the Rust shell on pull requests`, (2) `fix: update react-router-dom and tar to patched versions`, (3) `chore: add Dependabot configuration`. Conventional commits, matching `git log`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Part A — Rust job

#### Step 1: Check whether you can run the Rust build locally

Run `cargo --version` and `uname -s`.

- If `cargo` exists and `uname -s` prints `Darwin`: you will verify the job's commands locally in Step 3.
- Otherwise: skip Step 3, and say in your final report that the Rust commands were NOT run locally.

**Verify**: you know which case applies.

#### Step 2: Add the `rust` job

In `.github/workflows/ci.yml`, append this job after the `quality` job. It is a sibling of `quality`: `rust:` is indented two spaces, exactly like `quality:`.

```yaml

  rust:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Rust toolchain
        uses: dtolnay/rust-toolchain@stable

      - name: Cache cargo build
        uses: Swatinem/rust-cache@v2
        with:
          workspaces: apps/desktop-companion/src-tauri

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10.5.2

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm

      - name: Install
        run: pnpm install --frozen-lockfile

      # The Tauri build script needs these three outputs to exist.
      - name: Build frontend
        run: pnpm --filter @joyus/desktop-companion run build:frontend

      - name: Bundle sidecar
        working-directory: apps/desktop-companion
        run: node scripts/bundle-sidecar.mjs

      - name: Download Node.js sidecar binary
        working-directory: apps/desktop-companion
        run: node scripts/download-node.mjs

      - name: Compile and test the Rust shell
        working-directory: apps/desktop-companion/src-tauri
        run: cargo test --locked
```

Do not change the `quality` job.

**Verify**:
- `grep -c '^  rust:$' .github/workflows/ci.yml` → `1`
- `grep -c '^  quality:$' .github/workflows/ci.yml` → `1`
- `grep -c 'cargo test --locked' .github/workflows/ci.yml` → `1`
- `grep -c "$(printf '\t')" .github/workflows/ci.yml` → `0` (no tab characters; YAML forbids them for indentation)

#### Step 3: Run the job's commands locally (macOS with cargo only)

From the repo root, run, in order:

1. `pnpm install --frozen-lockfile`
2. `pnpm --filter @joyus/desktop-companion run build:frontend`
3. `(cd apps/desktop-companion && node scripts/bundle-sidecar.mjs)`
4. `(cd apps/desktop-companion && node scripts/download-node.mjs)`
5. `(cd apps/desktop-companion/src-tauri && cargo test --locked)`

All outputs go to directories that are already ignored by git (`dist-ui/`, `binaries/`, `src-tauri/target/`).

**Verify**: command 5 exits 0 and prints `test result: ok`. `git status --short` shows only `.github/workflows/ci.yml` as modified. Commit (commit 1).

If command 5 fails with a message that the lock file needs to be updated, STOP (see STOP conditions).

### Part B — Patched dependencies

#### Step 4: Update `react-router-dom` and `tar`

Run:

1. `pnpm --filter @joyus/desktop-companion add react-router-dom@^7.18.2`
2. `pnpm --filter @joyus/desktop-companion add -D tar@^7.5.19`

**Verify**:
- `grep -c '"react-router-dom": "^7.18' apps/desktop-companion/package.json` → `1`
- `grep -c '"tar": "^7.5' apps/desktop-companion/package.json` → `1`
- `grep -c 'react-router@7.13.1' pnpm-lock.yaml` → `0`
- `grep -c 'tar@7.5.15' pnpm-lock.yaml` → `0`
- `git diff --stat` lists only `apps/desktop-companion/package.json` and `pnpm-lock.yaml` (plus `ci.yml` if you have not committed Part A)

#### Step 5: Prove nothing broke

Run `pnpm typecheck`, then `pnpm coverage`, then `pnpm test:integration`, then `pnpm audit --prod`.

If you are on macOS, also rerun `(cd apps/desktop-companion && node scripts/download-node.mjs)` to prove the new `tar` still unpacks the archive.

**Verify**: the first three exit 0. `pnpm audit --prod` prints "No known vulnerabilities found". If it lists an advisory in a package other than `react-router`, record it in your report and continue; if it still lists `react-router`, STOP. Commit (commit 2).

### Part C — Dependabot

#### Step 6: Create `.github/dependabot.yml`

Create the file with exactly this content:

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
    groups:
      production-dependencies:
        dependency-type: production
        update-types:
          - minor
          - patch
      development-dependencies:
        dependency-type: development
        update-types:
          - minor
          - patch

  - package-ecosystem: cargo
    directory: /apps/desktop-companion/src-tauri
    schedule:
      interval: weekly
    open-pull-requests-limit: 3
    groups:
      cargo-dependencies:
        patterns:
          - "*"
        update-types:
          - minor
          - patch

  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    groups:
      actions:
        patterns:
          - "*"
```

Major-version updates are left ungrouped on purpose, so each arrives as its own pull request.

**Verify**:
- `grep -c 'package-ecosystem' .github/dependabot.yml` → `3`
- `grep -c "$(printf '\t')" .github/dependabot.yml` → `0`

Commit (commit 3).

## Test plan

This plan adds no unit tests. Its checks are:

- The existing gates (`pnpm typecheck`, `pnpm coverage`, `pnpm test:integration`) still pass with the updated `react-router-dom`. The UI route tests under `apps/desktop-companion/test/ui/` exercise the router.
- `pnpm audit --prod` reports no `react-router` advisory.
- `cargo test --locked` passes locally when a macOS toolchain is available.
- The `rust` job itself is proven only by a pull-request run on GitHub. You cannot do that without pushing. State this in your report so the operator checks the first run.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -c '^  rust:$' .github/workflows/ci.yml` prints 1
- [ ] `grep -c 'cargo test --locked' .github/workflows/ci.yml` prints 1
- [ ] `grep -c 'package-ecosystem' .github/dependabot.yml` prints 3
- [ ] `grep -c 'react-router@7.13.1' pnpm-lock.yaml` prints 0
- [ ] `grep -c 'tar@7.5.15' pnpm-lock.yaml` prints 0
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm coverage` exits 0
- [ ] `pnpm test:integration` exits 0
- [ ] `pnpm audit --prod` lists no `react-router` advisory
- [ ] `git diff --stat main..HEAD -- apps/desktop-companion/src-tauri/` prints nothing (this branch touches no Rust or Cargo file)
- [ ] Your report says whether Step 3 was run or skipped
- [ ] `plans/README.md` status row for 011 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `ci.yml` does not match the excerpt in "Current state".
- `pnpm add` reports that `react-router-dom@^7.18.2` or `tar@^7.5.19` does not exist. Do not pick a different version yourself.
- A UI test or typecheck fails after the `react-router-dom` update. Report the failing test and error. Do not edit application code or tests to adapt to the new router version; that needs a decision.
- `cargo test --locked` fails because the lock file is out of date. That means `Cargo.lock` has drifted from `Cargo.toml`, which is its own finding. Do not run `cargo update` and do not remove `--locked`.
- `cargo test --locked` fails for any other reason on an unmodified tree. The Rust shell does not build on `main`; report the first error.
- You find yourself wanting to edit `Cargo.toml`, a `.rs` file, or a `keyring` feature.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The `rust` job downloads three Node.js archives on every run because `download-node.mjs` has no way to select one target. If that becomes slow, add target selection to the script in the release-pipeline plan; do not replace the download with a placeholder file without checking that the Tauri build script accepts it.
- Open pull request zivtech/joyus-desktop#5 also edits `apps/desktop-companion/package.json` and `pnpm-lock.yaml`. Whichever lands second will conflict in the lock file. Resolve by taking the other side's `package.json` changes and running `pnpm install`, never by hand-editing the lock file.
- Development-only advisories remain after this plan (on 2026-11-17: `vitest` 3.2.4 and `tinypool` 1.1.1 critical, `vite`, `postcss`, `nanoid`, `brace-expansion` and others). Some need a major `vitest` upgrade. Treat the first Dependabot pull requests as the place to handle them, and watch the coverage gate on any `@vitest/coverage-v8` change.
- Actions are referenced by tag (`@v4`, `@v2`, `@stable`), as in the existing workflows. Pinning them to commit hashes is a separate hardening step.
- Once Linux support merges, decide whether the `rust` job needs a Linux matrix entry.
- Reviewer focus: the `rust` job must stay a required check on pull requests, and the first run's log should show `test result: ok`.
