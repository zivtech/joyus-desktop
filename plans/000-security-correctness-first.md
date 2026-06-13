# Plan 000: Execute Security And Correctness Fixes First

## Summary

The initial plan set was useful, but the later correctness/security audit changed the priority order. Executing the old sequence unchanged would be dead process: it would make the verification surface cleaner while leaving known production defects unowned.

This plan moves bounded, evidence-backed security and correctness fixes ahead of broad UI coverage and docs refresh work.

## Priority

- Priority: P1
- Risk: High
- Effort: Medium
- Dependencies: None

## Evidence

- `apps/desktop-companion/src/sidecar/recon.ts:304` and `apps/desktop-companion/src/sidecar/recon.ts:320` accept any non-empty `engagementDir` for `recon.scan` and `recon.export`.
- `apps/desktop-companion/src/sidecar/recon.ts:374` recursively walks archive entries, and `apps/desktop-companion/src/sidecar/recon.ts:478` reads the collected paths.
- `apps/desktop-companion/src/sidecar/chrome-detect.ts:37` and `apps/desktop-companion/src/sidecar/claude-detect.ts:29` execute shell command strings.
- `apps/desktop-companion/src/sidecar/configCheckPoller.ts:43` reads response text before checking HTTP status.
- `apps/desktop-companion/src/handoffOrchestrator.ts:361-364` skips missing artifact payloads and lets upload fail later.
- `packages/session-manager/src/sessionCloser.ts:98-118` always creates a draft PR when `createPr` is true, even if the branch already has `prNumber`.

## Scope

Implement these fixes before Plan 003 and Plan 005:

1. Restrict recon scan/export paths.
   - Canonicalize `engagementDir` with `realpath`.
   - Default the allowed base to the existing recon root under `~/Documents/joyus-recon-engagements`.
   - Allow tests to inject an alternate base.
   - Reject paths outside the allowed base.

2. Block symlink archive traversal.
   - Do not follow symlinks during archive collection.
   - Add tests proving a symlink to an external file is not archived.

3. Remove shell-string binary probes.
   - Replace `execSync(commandString)` probes with argument-array execution.
   - Preserve test injection by changing the dependency shape deliberately.

4. Treat non-OK config poll responses as transport failures.
   - Check `response.ok` before hashing/parsing.
   - Include status details in the error.
   - Preserve the previous manifest hash on failure.

5. Fail fast on missing handoff artifact payloads.
   - Validate that every artifact reference has data before encryption.
   - Include missing artifact IDs in the thrown error message.

6. Reuse stored PR metadata on repeated managed close.
   - If `createPr` is true and `branch.prNumber` is already set, push as usual but do not create a duplicate PR.
   - Return existing PR metadata and do not fire `onPrCreated` again.

## Out Of Scope

- Do not invent the sidecar sync IPC adapter in this plan.
- Do not change release signing policy in this plan.
- Do not broaden UI coverage in this plan.

## Verification

Run targeted tests:

```bash
pnpm vitest run apps/desktop-companion/test/sidecar/recon.test.ts apps/desktop-companion/test/sidecar/server-management.test.ts apps/desktop-companion/test/sidecar/configCheckPoller.test.ts apps/desktop-companion/test/handoffOrchestrator.test.ts packages/session-manager/test/sessionCloser.test.ts
```

Then run:

```bash
pnpm typecheck
pnpm test
pnpm coverage
```

After Plan 004 lands, run:

```bash
pnpm test:integration
pnpm run ci
```

## STOP Conditions

Stop instead of guessing if:

- Recon has a documented engagement root different from `~/Documents/joyus-recon-engagements`.
- Artifact upload URL ordering is intentionally guaranteed by control-plane contract but not represented in local types.
- PR recreation is expected to be forced by a caller flag that does not yet exist.
