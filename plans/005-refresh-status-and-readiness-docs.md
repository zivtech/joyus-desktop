# Plan 005: Refresh Status And Readiness Docs

## Summary

Several high-level status documents describe older project state than the code and spec status files show. This creates handoff risk: future agents or maintainers may plan from stale prose instead of current implementation.

## Priority

- Priority: P2
- Risk: Medium
- Effort: Small to Medium
- Dependencies: None

## What This Is Not Claiming

- This plan is not claiming the status JSON files are automatically authoritative.
- This plan is not claiming all release-readiness work is complete.
- This plan is claiming the current docs mix current and stale signals without enough dates or source references.

## Evidence

README drift:

- `README.md:66-68` and `README.md:129-137` describe backlog/status items that no longer align with current spec status files.
- `kitty-specs/006-runtime-orchestrator/status.json:13-17` reports completed status.
- `kitty-specs/007-onboarding-skill-sync/status.json:13-17` reports completed status.
- `kitty-specs/008-recon-operator/status.json:13-17` reports completed status.

Release docs drift:

- `docs/release/desktop-feature-matrix.md:3` has an older audit date.
- `docs/release/desktop-feature-matrix.md:12-14` says there is no UI for spec 007.
- `apps/desktop-companion/src/ui/App.tsx:56-64` includes UI routes for app sections.
- `apps/desktop-companion/src/ui/components/Layout.tsx:4-15` includes navigation items.
- `docs/release/desktop-readiness-audit.md:10` and `docs/release/desktop-readiness-audit.md:78-81` describe an older readiness picture.

Recon follow-up still appears incomplete:

- `kitty-specs/recon-operator-01KRA2P1/tasks.md:179-180` leaves T030 unchecked.
- `kitty-specs/recon-operator-01KRA2P1/tasks.md:253-260` leaves T052 unchecked.

## Implementation Steps

1. Re-read source status before editing docs.
   - Read each relevant `status.json`.
   - Read the matching `tasks.md` or `tasks/` files.
   - Cross-check against code paths instead of trusting status files alone.

2. Update `README.md`.
   - Replace stale backlog language for specs 006, 007, and 008 with dated current status.
   - Where work remains, name the remaining work exactly instead of leaving broad "in progress" language.
   - Keep the README concise; do not turn it into a release audit.

3. Update `docs/release/desktop-feature-matrix.md`.
   - Refresh the audit date.
   - Correct the statement that spec 007 has no UI if current routes/components prove otherwise.
   - Separate "implemented", "wired", "tested", and "release-ready" where those differ.

4. Update `docs/release/desktop-readiness-audit.md`.
   - Preserve historical findings only if clearly dated as historical.
   - Add current blockers from Plans 001 through 004 if they remain unresolved.
   - Explicitly state what is not covered by the audit.

5. Do not mark recon UAT/runbook tasks done unless the evidence exists.
   - If T030/T052 remain incomplete, keep them incomplete and name them as readiness follow-up.

## Acceptance Criteria

- README status language matches current spec status and verified code reality.
- Release docs have a current audit date and no longer state that implemented UI routes do not exist.
- Remaining release-readiness gaps are specific and actionable.
- No task checkbox is marked done without direct evidence.

## Verification

```bash
pnpm typecheck
pnpm test
```

Then inspect the docs for stale phrasing:

```bash
rg "in progress|no UI|April|readiness|006|007|008|recon" README.md docs/release kitty-specs
```

Manual review is required. The command is only a prompt to inspect possible stale text.

## Adversarial Self-Check

The risk is polishing a stale summary into a more fluent stale summary. Go back to source files and code before changing status prose. If a claim cannot be tied to a status file, task file, test, or implementation path, soften it or remove it.
