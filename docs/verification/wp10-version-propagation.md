# WP10 — SC-005: Version Pin Propagation Verification (T060)

**Spec**: 003-skill-mcp-distribution
**Success Criterion**: SC-005 — Version pin update propagates to both Cowork and CLI within one session restart
**Work Package**: WP10 — Phase 1 Verification & Rollout
**Status**: PENDING
**Last Updated**: ____-__-__

---

## Purpose

Verify that when an admin updates the version pin, both Cowork and CLI channels receive the update within one session restart. This confirms that the version propagation pipeline works end-to-end.

---

## Current State

| Field | Value |
|-------|-------|
| Current pinned version | |
| New test version (tag) | |
| Admin performing update | |
| Test date | |

---

## Test Procedure

### Step 1: Verify Current Version

Confirm both channels are on the current version before making changes.

| Channel | Current Version | Verified? | Timestamp |
|---------|----------------|-----------|-----------|
| Cowork | | Yes / No | |
| CLI (skill-sync status) | | Yes / No | |

### Step 2: Create New Tag

| Action | Detail | Timestamp |
|--------|--------|-----------|
| New tag/version created | | |
| Tag pushed to registry | | |
| Tag verified in registry | | |

### Step 3: Update Version Pin

| Action | Detail | Timestamp |
|--------|--------|-----------|
| Admin updates pin to new version | | |
| Pin update confirmed in admin UI | | |
| Pin update propagated to config store | | |

### Step 4: Test Cowork Propagation

| Action | Detail | Timestamp |
|--------|--------|-----------|
| Close Cowork session | | |
| Reopen Cowork (new session) | | |
| Check skill bundle version | | |
| Version matches new pin? | Yes / No | |

### Step 5: Test CLI Propagation

| Action | Detail | Timestamp |
|--------|--------|-----------|
| End CLI session | | |
| Start new CLI session (`skill-sync start`) | | |
| Run `skill-sync status` | | |
| Version matches new pin? | Yes / No | |

---

## Timing Table

| Action | Timestamp | Channel | Result |
|--------|-----------|---------|--------|
| Pin updated by admin | | Admin UI | |
| Cowork session restarted | | Cowork | |
| Cowork version confirmed | | Cowork | New version / Old version |
| CLI session restarted | | CLI | |
| CLI version confirmed | | CLI | New version / Old version |

**Time from pin update to Cowork confirmation**: ________ minutes
**Time from pin update to CLI confirmation**: ________ minutes

---

## Propagation Path Verification

Verify each step in the propagation chain:

| Step | Component | Status | Evidence |
|------|-----------|--------|----------|
| 1 | Admin sets new pin | | |
| 2 | Pin stored in config service | | |
| 3 | Cowork reads new pin on session start | | |
| 4 | Cowork downloads/caches new version | | |
| 5 | CLI reads new pin on session start | | |
| 6 | CLI downloads/caches new version | | |

---

## Rollback Test (Optional)

Verify that reverting the pin also propagates correctly.

| Action | Timestamp | Result |
|--------|-----------|--------|
| Admin reverts pin to original version | | |
| Cowork session restarted | | |
| Cowork shows original version? | | Yes / No |
| CLI session restarted | | |
| CLI shows original version? | | Yes / No |

---

## Edge Cases Tested

| Scenario | Tested? | Result | Notes |
|----------|---------|--------|-------|
| Pin update during active session | Yes / No | | Should not affect until restart |
| Multiple rapid pin changes | Yes / No | | Should resolve to latest |
| Network interruption during sync | Yes / No | | Should retry or fail gracefully |
| Invalid version pin | Yes / No | | Should reject with clear error |

---

## Pass Criteria

SC-005 passes when ALL of the following are true:

- [ ] Cowork receives updated version within one session restart
- [ ] CLI receives updated version within one session restart
- [ ] No manual intervention required beyond restarting sessions
- [ ] Version displayed matches the new pin exactly
- [ ] Propagation completes without errors

---

## SC-005 Verdict

**SC-005 Result**: PASS / FAIL

**Verified By**: ________________________
**Date**: ____-__-__
**Notes**: _________________________________________________
