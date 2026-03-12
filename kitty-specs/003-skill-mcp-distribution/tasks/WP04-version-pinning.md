---
work_package_id: WP04
title: Version Pinning & Admin Controls
lane: "for_review"
dependencies: []
subtasks:
- T019
- T020
- T021
- T022
- T023
phase: Phase 1 - Cowork Distribution
assignee: ''
agent: "codex"
shell_pid: "39444"
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-03-10T00:00:00Z'
  lane: planned
  agent: ''
  action: Prompt generated
---

# Work Package Prompt: WP04 - Version Pinning & Admin Controls

## Objective

Establish a version control mechanism so admins can pin skills to a specific release, ensuring all users (Cowork and CLI) receive the exact same version until the admin explicitly updates the pin.

## Context

Without version pinning, skill updates could roll out unpredictably — breaking workflows or introducing untested changes. The admin needs a single lever to control what version all users receive across both distribution channels. This pin is the source of truth that WP03 (git sync) and WP01 (Cowork plugins) both read.

**Source repo**: `zivtech-meta-skills` (to be tagged with semver)
**Requirements**: FR-004, SC-005, NFR-001

## Subtasks

### T019: Establish semver tagging convention for zivtech-meta-skills

**Purpose**: Create a consistent versioning scheme so pins are meaningful and predictable.

**Steps**:
1. Define semver convention for the skills repo:
   - **MAJOR** (x.0.0): Breaking changes to skill format, removed skills, incompatible plugin structure changes
   - **MINOR** (0.x.0): New skills added, non-breaking enhancements to existing skills
   - **PATCH** (0.0.x): Typo fixes, prompt refinements, documentation updates
2. Tag the current state of `zivtech-meta-skills` as `v1.0.0` (or appropriate based on current maturity).
3. Create `CHANGELOG.md` in the repo root with initial release notes:
   ```markdown
   # Changelog
   ## v1.0.0 - 2026-03-XX
   - Initial release: 29 skills across development, PM, business, and research domains
   - Bundle definitions: PM, Developer, Milk Jawn, Full
   ```
4. Document the release process:
   - How to create a new version: update CHANGELOG → `git tag v1.x.x` → `git push --tags`
   - Who can create releases (admin only)
   - When to bump MAJOR vs MINOR vs PATCH
5. Optionally: create a GitHub Actions workflow that creates a GitHub Release on tag push.

**Files**: `zivtech-meta-skills/CHANGELOG.md`, `docs/admin-guides/versioning-convention.md`, optionally `zivtech-meta-skills/.github/workflows/release.yml`

**Validation**: At least one semver tag (`v1.0.0`) exists on the repo. CHANGELOG documents what's in that version. Release process is documented clearly.

---

### T020: Build distribution config API on joyus-ai

**Purpose**: Central API endpoint that all clients (Cowork, CLI sync, desktop companion) read to determine which version to distribute. Per plan AD-002.

**Steps**:
1. Add two endpoints to joyus-ai:
   - `GET /api/distribution/config` — returns current version pins per bundle (public, API key auth)
   - `PUT /api/distribution/config` — admin updates pins (admin auth required)
2. Response shape:
   ```json
   {
     "schema_version": "1",
     "default_version": "v1.0.0",
     "bundles": {
       "pm-bundle": { "version": "v1.0.0" },
       "developer-bundle": { "version": "v1.0.0" },
       "milk-jawn-bundle": { "version": "v1.0.0" },
       "full-bundle": { "version": "v1.0.0" }
     },
     "updated_at": "2026-03-10T00:00:00Z",
     "updated_by": "admin@zivtech.com"
   }
   ```
2. Store in a location accessible to both channels:
   - **Option A**: In the `zivtech-meta-skills` repo root (sync script reads it before checking out a tag)
   - **Option B**: In a separate config repo or Gist (independent of skill version)
   - **Option C**: Simple endpoint (e.g., GitHub raw file URL)
   - Recommend Option A for simplicity — config file is always at HEAD of `main`, even when skills are checked out at a tag.
3. Document how admin updates the pin:
   - Edit `distribution-config.json` → change version → commit → push
   - All sync clients pick up the new pin on next check

**Files**: `config/distribution-config.json`, `docs/admin-guides/version-pinning.md`

**Validation**: Config file is parseable JSON. Contains version pins for all defined bundles. Admin can update a pin with a simple file edit and commit.

---

### T021: Ensure Cowork plugin updates respect pin

**Purpose**: Cowork users receive the pinned version even if a newer version exists in the repo.

**Steps**:
1. Determine how Cowork plugin versioning works:
   - Does admin manually upload specific plugin versions? → Document the upload-at-version process
   - Does Cowork auto-update from a source? → Determine how to lock to a specific version
   - Does Cowork support version fields in plugin metadata? → Use them
2. Based on the mechanism:
   - **If manual upload**: Admin uploads plugin content from the pinned git tag. Document the process: "To update skills, checkout tag vX.Y.Z, build plugins, upload to Cowork admin."
   - **If auto-source**: Point Cowork at a URL that serves the pinned version (e.g., GitHub release asset).
   - **If version metadata**: Set version field in plugin to match the pin.
3. Test: Push `v1.1.0` to repo while pin is `v1.0.0` → verify Cowork still serves `v1.0.0`.
4. Update pin to `v1.1.0` → update Cowork → verify users get `v1.1.0`.

**Validation**: Cowork users receive pinned version, not latest. Updating pin causes users to receive new version on next session.

---

### T022: Ensure git sync respects the same pin

**Purpose**: CLI developers get the same pinned version as Cowork users — single source of truth.

**Steps**:
1. Modify the sync script from WP03 to read the version pin:
   - Before checking out a tag, fetch `distribution-config.json` from `main` branch
   - Parse the config, look up the bundle relevant to the user (or use `default_version`)
   - Use the pinned version as the checkout target
2. If using Option A (config in repo):
   - `git fetch origin main` → read `distribution-config.json` from fetched main → checkout pinned tag
   - This requires fetching main branch HEAD even when checking out a different tag
3. If using Option B/C (external config):
   - Fetch config from URL/endpoint before git operations
4. Ensure sync script and Cowork distribution read from the SAME config source.

**Files**: Updates to sync script from WP03 (`packages/skill-sync/src/sync.ts`)

**Validation**: CLI developer receives same version as Cowork users. Change pin → CLI updates on next sync. Sync reads from same source as Cowork.

---

### T023: Verify version pin change propagates within one session restart (SC-005)

**Purpose**: End-to-end validation that version control works across both channels.

**Steps**:
1. Set pin to `v1.0.0` in `distribution-config.json`.
2. Verify a Cowork user has `v1.0.0` skills (check skill behavior or version indicator).
3. Verify a CLI developer has `v1.0.0` skills (check `.sync-metadata.json`).
4. Create `v1.1.0` tag with a visible change (e.g., add a new skill or modify an existing one).
5. Update pin to `v1.1.0` in `distribution-config.json`, commit, push.
6. Cowork user starts new session → verify `v1.1.0` skills are active.
7. CLI developer starts new Claude Code session → verify sync updates to `v1.1.0`.
8. Document propagation timing for both channels.

**Files**: `docs/verification/wp04-version-pin-verification.md`

**Validation**: Both channels receive updated version within one session restart. Timing documented. Evidence captured.

## Implementation Notes

- **Simplest approach**: JSON config file in the `zivtech-meta-skills` repo root, read by sync script from `main` branch HEAD. Cowork admin manually uploads from the tagged version.
- **Config vs code**: The pin is configuration, not code. Keep it editable without a code review process (or with a lightweight one).
- **Consider a CLI tool**: `skill-admin pin pm-bundle v1.1.0` that updates the config and commits — reduces human error.
- **Rollback**: Pinning to an older version (e.g., `v1.0.0` after `v1.1.0`) should work identically to a forward update.

## Done Criteria

- [ ] Semver tagging convention established with at least one tag (T019)
- [ ] Admin config defines pinned version per bundle (T020)
- [ ] Cowork distribution respects the pin (T021)
- [ ] CLI git sync respects the pin (T022)
- [ ] Version pin change verified to propagate within one session restart (T023)

## Risks & Edge Cases

- **Config caching**: Sync script may cache the config — ensure cache invalidation on every sync run
- **Non-existent tag**: Admin pins to a tag that doesn't exist — sync script should error clearly, not silently fail
- **Concurrent admin updates**: Multiple admins updating the pin — last write wins (document this)
- **New bundle without pin**: Bundle added after initial config — needs `default_version` fallback
- **Rollback**: Admin pins to an older version — must work cleanly (git checkout handles this)
- **Config format evolution**: Version the config schema (`schema_version`) for future changes

## Implementation Command

```bash
spec-kitty implement WP04 --base WP01
```

## Activity Log

- 2026-03-10: Prompt generated in planned lane.
- 2026-03-11T00:59:50Z – codex – shell_pid=39444 – lane=doing – Started WP04 implementation
- 2026-03-11T01:48:58Z – codex – shell_pid=39444 – lane=doing – Implemented automated CLI pin propagation verification and added Cowork manual pin checklist; waiting on live Cowork execution for T021/T023 final sign-off
- 2026-03-12T01:59:58Z – codex – shell_pid=39444 – lane=for_review – Ready: distribution-config.json, versioning convention, admin pin guide, API contract, pin verification.
