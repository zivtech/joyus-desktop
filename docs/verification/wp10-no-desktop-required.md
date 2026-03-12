# WP10 — FR-014: No Desktop Companion Required (T055)

**Spec**: 003-skill-mcp-distribution
**Functional Requirement**: FR-014 — Cowork functions without joyus-desktop companion app
**Work Package**: WP10 — Phase 1 Verification & Rollout
**Status**: PENDING
**Last Updated**: ____-__-__

---

## Purpose

Negative test to confirm that all Phase 1 functionality (Cowork skills, cloud MCP connectors, CLI sync) operates correctly when the joyus-desktop companion application is NOT installed or running. This validates the architectural decision that Phase 1 is cloud-native and does not depend on a local desktop process.

---

## Pre-conditions

Before beginning this test, confirm:

- [ ] joyus-desktop application is NOT installed on the test machine
- [ ] No joyus-desktop background processes are running
- [ ] No joyus-desktop Electron/Node processes present in the process list
- [ ] Test machine has network access to Cowork cloud services
- [ ] Test user accounts are provisioned and org-configured

---

## Step 1: Verify No Desktop Processes

Run the following checks and record results:

| Check | Command / Method | Expected Result | Actual Result | Pass/Fail |
|-------|------------------|-----------------|---------------|-----------|
| No joyus-desktop in Applications | `ls /Applications \| grep -i joyus` | No match | | |
| No joyus-desktop processes | `ps aux \| grep -i joyus-desktop` | No match (except grep itself) | | |
| No Electron processes from joyus | `ps aux \| grep -i electron \| grep -i joyus` | No match | | |
| No joyus-desktop launch agents | `ls ~/Library/LaunchAgents/ \| grep -i joyus` | No match | | |
| No joyus-desktop in login items | System Preferences > Login Items | Not listed | | |

---

## Step 2: Test Cowork Skills (Without Desktop)

| # | Test | Action | Expected Result | Actual Result | Pass/Fail |
|---|------|--------|-----------------|---------------|-----------|
| 2.1 | Login to Cowork | Authenticate via browser | Login succeeds | | |
| 2.2 | View skill bundle | Navigate to Skills | Bundle visible | | |
| 2.3 | Invoke skill | Execute a skill | Skill returns result | | |
| 2.4 | Invoke second skill | Execute a different skill | Skill returns result | | |
| 2.5 | Check for desktop prompts | Observe UI during usage | No prompts to install desktop app | | |

---

## Step 3: Test Cloud MCP Connectors (Without Desktop)

| # | Connector | Action | Expected Result | Actual Result | Pass/Fail |
|---|-----------|--------|-----------------|---------------|-----------|
| 3.1 | Slack | List channels or search | Returns data | | |
| 3.2 | Google | Access Drive or Calendar | Returns data | | |
| 3.3 | Atlassian | List projects or issues | Returns data | | |

---

## Step 4: Test CLI Sync (Without Desktop)

| # | Test | Action | Expected Result | Actual Result | Pass/Fail |
|---|------|--------|-----------------|---------------|-----------|
| 4.1 | Install skill-sync | `npm install -g @joyus/skill-sync` | Installs without desktop dependency | | |
| 4.2 | Authenticate | `skill-sync auth` | Auth succeeds | | |
| 4.3 | Start session | `skill-sync start` | Session starts, skills sync | | |
| 4.4 | Invoke skill | `skill-sync invoke <skill>` | Skill executes | | |
| 4.5 | Check for desktop dependency errors | Review logs | No desktop-related errors | | |

---

## Step 5: Verify No Degradation

Confirm that without the desktop companion, there is no degradation in:

| Capability | Functions Normally? | Notes |
|------------|---------------------|-------|
| Skill invocation latency | Yes / No | |
| MCP connector response times | Yes / No | |
| CLI sync speed | Yes / No | |
| Telemetry collection | Yes / No | |
| Version pin enforcement | Yes / No | |

---

## Evidence Summary

| Area | Tests Run | Tests Passed | Tests Failed |
|------|-----------|--------------|--------------|
| Process verification | 5 | | |
| Cowork skills | 5 | | |
| MCP connectors | 3 | | |
| CLI sync | 5 | | |
| Degradation check | 5 | | |
| **Total** | **23** | | |

---

## Conclusion

- [ ] joyus-desktop is confirmed NOT running/installed
- [ ] All Cowork skills function without desktop companion
- [ ] All cloud MCP connectors function without desktop companion
- [ ] CLI sync functions without desktop companion
- [ ] No degradation observed in any capability
- [ ] No UI prompts or errors referencing desktop companion

**FR-014 Verdict**: PASS / FAIL

**Tested By**: ________________________
**Test Machine**: ________________________
**Date**: ____-__-__
**Notes**: _________________________________________________
