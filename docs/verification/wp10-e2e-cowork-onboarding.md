# WP10 — E2E Cowork User Onboarding Verification (T053)

**Spec**: 003-skill-mcp-distribution
**Work Package**: WP10 — Phase 1 Verification & Rollout
**Status**: PENDING
**Last Updated**: ____-__-__

---

## Purpose

Verify that Cowork users can complete the full onboarding flow — from login through skill invocation and MCP connector usage — without assistance and within acceptable time thresholds.

---

## Prerequisites

- Admin has completed org configuration (skill bundles assigned, MCP connectors enabled)
- Target user accounts provisioned in Cowork
- Skill bundle includes at least one invocable skill
- At least one MCP connector (Atlassian, Slack, or Google) configured for the org

---

## Test Procedure

### Step 1: Login

1. User opens Cowork
2. User authenticates with org credentials
3. Verify successful login (dashboard loads, org context visible)

### Step 2: Verify Bundle

1. Navigate to Skills section
2. Confirm assigned skill bundle is visible
3. Confirm individual skills within the bundle are listed
4. Confirm version matches the admin-configured pin

### Step 3: Invoke Skill

1. Select a skill from the bundle
2. Execute the skill with a sample input
3. Confirm skill returns a successful result
4. Record time from login to first successful invocation

### Step 4: Use MCP Connector

1. Navigate to MCP connector integration
2. Select an enabled connector (e.g., Slack)
3. Execute a connector action (e.g., list channels, search messages)
4. Confirm connector returns valid data

---

## Evidence Table

| # | Timestamp | User | Org | Action | Expected Result | Actual Result | Pass/Fail | Evidence (screenshot/log) |
|---|-----------|------|-----|--------|-----------------|---------------|-----------|---------------------------|
| 1 | | | | Login | Dashboard loads | | | |
| 2 | | | | View bundle | Skills visible | | | |
| 3 | | | | Invoke skill | Successful output | | | |
| 4 | | | | Use MCP connector | Valid data returned | | | |

---

## Zivtech User Test

**Test User**: ________________________
**Role**: ________________________
**Org**: Zivtech
**Date**: ____-__-__

| Step | Timestamp | Result | Notes |
|------|-----------|--------|-------|
| Login | | | |
| Verify bundle | | | |
| Invoke skill | | | |
| Use MCP connector | | | |

**Time from login to first skill invocation**: ________ minutes
**Unassisted?**: Yes / No
**Issues encountered**: _________________________________________________

---

## Milk Jawn User Test

**Test User**: ________________________
**Role**: ________________________
**Org**: Milk Jawn
**Date**: ____-__-__

| Step | Timestamp | Result | Notes |
|------|-----------|--------|-------|
| Login | | | |
| Verify bundle | | | |
| Invoke skill | | | |
| Use MCP connector | | | |

**Time from login to first skill invocation**: ________ minutes
**Unassisted?**: Yes / No
**Issues encountered**: _________________________________________________

---

## Metrics Summary

| Metric | Zivtech | Milk Jawn | Target |
|--------|---------|-----------|--------|
| Time to first invocation | | | < 15 min |
| Steps completed without help | /4 | /4 | 4/4 |
| MCP connector functional | | | Yes |
| Bundle version correct | | | Yes |

---

## Overall Result

- [ ] Zivtech user completed onboarding successfully
- [ ] Milk Jawn user completed onboarding successfully
- [ ] Both users invoked skills without assistance
- [ ] MCP connectors functional for both orgs

**Verdict**: PASS / FAIL / PARTIAL

**Verified By**: ________________________
**Date**: ____-__-__
**Notes**: _________________________________________________
