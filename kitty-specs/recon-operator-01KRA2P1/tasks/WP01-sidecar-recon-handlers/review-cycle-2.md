---
affected_files: []
cycle_number: 2
mission_slug: recon-operator-01KRA2P1
reproduction_command:
reviewed_at: '2026-05-10T23:59:16Z'
reviewer_agent: unknown
verdict: rejected
wp_id: WP01
---

# WP01 Review — Cycle 1

**Verdict**: Changes requested (2 blockers)

---

## What the implementation gets right

- `registerReconMethods(ipc: IpcHandler)` is correctly exported and follows the codebase pattern.
- `recon.create` creates the engagement directory, writes `.recon-meta.json` with all required fields, and returns `{ engagementDir, engagementId, clientSlug }`.
- `recon.scan` delegates to shared `runScan()`, parses stderr findings with the correct regex, returns `{ passed, findings }`, and correctly treats non-zero exit with findings as `passed: false` (not a fatal error).
- `recon.export` enforces the scan gate, writes `.scan-overrides.json` on override, excludes all specified sensitive filenames and directories, and returns the correct shape for both blocked and success cases.
- `scan-sensitive-output.mjs` is present in `apps/desktop-companion/resources/` and referenced in `tauri.conf.json`. The resource entry matches the spec exactly.
- TypeScript is clean for `recon.ts` (pre-existing errors in other modules are unrelated to this WP).
- No files outside `owned_files` were modified.
- No secrets or hardcoded credentials.
- IPC wiring into `services.ts` is correctly deferred to WP02 (confirmed by WP02 frontmatter).

---

## Blocker 1 — No tests

**Observation**: The codebase has an established pattern where every sidecar handler module has corresponding unit tests: `usage-collector.ts` is covered by `usage-onboarding.test.ts`, `chrome-detect.ts` by `server-management.test.ts`, `configCheckPoller.ts` by `configCheckPoller.test.ts`, etc. `recon.ts` has no test file.

**Relevant doctrine**: DIRECTIVE_034 (Test-First Development). The success criteria also state that `recon.scan` must be able to "detect a test credential string... placed in a file inside a temp engagement dir" — this is a testable acceptance criterion that should be expressed as a test, not only verified manually.

**Required**: Add a test file at `apps/desktop-companion/test/sidecar/recon.test.ts` (or equivalent conventional location) covering at minimum:

1. `slugify` edge cases (spaces, special characters, unicode, leading/trailing hyphens)
2. `recon.create` — happy path: directory created, `.recon-meta.json` written with correct fields, return value shape correct
3. `recon.create` — input validation errors (missing `clientName`, `url`, `accessMode`)
4. `recon.scan` — via `runScan` with a temp dir containing a file with a known credential string (e.g., `ANTHROPIC_API_KEY=sk-ant-test-xxxx`) — expects `{ passed: false, findings: [{ file, line, pattern }] }`
5. `recon.scan` — clean engagement dir expects `{ passed: true, findings: [] }`
6. `recon.export` — scan gate: returns `{ blocked: true, findings }` when scan fails and `overrideScan` is falsy
7. `recon.export` — override path: writes `.scan-overrides.json`, returns `{ overridden: true }` when `overrideScan: true`

For `runScan` tests that spawn a real child process, mock `spawn` at the module boundary or use the actual script against a temp directory — both are acceptable given the existing project patterns.

---

## Blocker 2 — Undocumented deviation from spec: hand-rolled ZIP encoder

**Observation**: T004 specifies: "Use the `archiver` npm package (already used elsewhere in the sidecar, or add as dependency) or Node's built-in `zlib` streams with `tar`. Do not shell out to `zip`."

The implementation chose neither option. It implements a custom 220-line ZIP encoder from scratch — including a CRC-32 lookup table, local file headers, central directory records, and an EOCD record. This is a valid technique but it is a third option not on the spec's menu.

Per DIRECTIVE_010 (Specification Fidelity), deviations from approved specifications must be explicitly documented and reviewed before acceptance. The commit message and code comments do not acknowledge this as a deviation.

**Risks of the hand-rolled approach that require deliberate sign-off**:
- Custom CRC-32 and ZIP format implementations are historically a source of off-by-one and edge-case bugs (e.g., files >4 GB would silently corrupt with 32-bit size fields; empty directories are not represented).
- No external test suite validates the ZIP output's correctness against a real unzip tool.
- It introduces ~220 lines of low-level binary code with no dedicated tests.

**Required**: One of the following:

**Option A (preferred)**: Replace the hand-rolled ZIP with the `archiver` npm package or Node's `zlib` + `tar` streams as specified. The `archiver` option requires adding it to `package.json` if not already present — that is explicitly permitted by the spec ("or add as dependency").

**Option B (deviation approval)**: If the hand-rolled ZIP is intentionally preferred (e.g., to avoid adding a dependency), document this explicitly:
  1. Add a `// SPEC-DEVIATION:` comment block at the top of the ZIP section explaining why this approach was chosen over the spec options and acknowledging the tradeoffs.
  2. Add a test that extracts the produced ZIP using Node's `unzipper` or a shell `unzip` call and asserts that the correct files are present and sensitive files are excluded.

Option B requires the deviation to pass review; the current code does not provide enough documentation or test coverage to approve it on the hand-rolled path.

---

## Non-blocking observations

- **`recon.export` function length**: The handler is ~220 lines inline. Once the ZIP logic is addressed (Blocker 2), consider extracting the file collection and ZIP building into named helper functions for readability. Not required for approval.
- **`resolveScanScript` fallback ordering**: The primary candidate looks one level up then into `resources/`; the flat-copy fallback looks in the same directory. Comment is accurate. This is fine.
- **`pad2` / `slugify` helpers**: Clean, correct, not over-engineered.
- **Error messages**: Consistently descriptive and include the offending path or field name. Good pattern.

---

## Rebase note for WP02, WP06, WP07

WP02, WP06, and WP07 depend on WP01 (per topology). Since WP01 is being returned to `planned`, no rebase is needed — those WPs are already in `planned` state and will wait for WP01 to be re-implemented and approved before proceeding. No action required on their part at this time.
