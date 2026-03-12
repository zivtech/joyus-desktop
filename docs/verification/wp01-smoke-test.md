# WP01 Smoke Test: Skill Distribution Verification

**Date**: 2026-03-10
**Status**: Template (to be completed during T004/T005 execution)

## Purpose

End-to-end verification that skills are distributable via Cowork and invocable by non-admin users in both Zivtech and Milk Jawn organizations.

## Prerequisites

- [ ] Bundle manifests created (`config/bundles/*.json`)
- [ ] Cowork plugin files generated (`scripts/build-cowork-plugins.ts` executed)
- [ ] Bundles uploaded to Cowork admin panels for both orgs
- [ ] At least one non-admin user assigned per org

## Test 1: Zivtech PM User

**User**: [name] (non-admin, PM role)
**Bundle**: pm-bundle
**Date**: ____

| Step | Action | Expected Result | Actual | Pass? |
|------|--------|-----------------|--------|-------|
| 1 | Log in to Zivtech Cowork workspace | Dashboard loads | | |
| 2 | Check available skills/commands | PM Bundle skills visible (15 skills) | | |
| 3 | Invoke `proposal-critic` with a sample plan | Structured review with phases, perspectives, verdict | | |
| 4 | Verify output has investigation protocol | Numbered phases, evidence requirements, severity | | |
| 5 | Invoke `copy-critic` with sample copy | Brand voice, tone, clarity, SEO assessment | | |
| 6 | Verify no developer-only skills visible | drupal-planner, react-planner NOT in commands | | |

**Evidence**: [paste session timestamps, output summaries]

## Test 2: Milk Jawn User

**User**: [name] (non-admin)
**Bundle**: milk-jawn-bundle
**Date**: ____

| Step | Action | Expected Result | Actual | Pass? |
|------|--------|-----------------|--------|-------|
| 1 | Log in to Milk Jawn Cowork workspace | Dashboard loads | | |
| 2 | Check available skills/commands | Milk Jawn Bundle skills visible (22 skills) | | |
| 3 | Invoke `health-equity-analyzer` with sample | 8-dimension equity analysis | | |
| 4 | Invoke `policy-brief-critic` with sample brief | Evidence quality, options analysis review | | |
| 5 | Verify no Zivtech-internal skills visible | drupal-planner, content-model-critic NOT in commands | | |

**Evidence**: [paste session timestamps, output summaries]

## Test 3: Developer User (optional)

**User**: [name] (developer role)
**Bundle**: developer-bundle
**Date**: ____

| Step | Action | Expected Result | Actual | Pass? |
|------|--------|-----------------|--------|-------|
| 1 | Log in to Zivtech Cowork workspace | Dashboard loads | | |
| 2 | Check available skills/commands | Developer Bundle skills visible (19 skills) | | |
| 3 | Invoke `a11y-critic` with sample HTML | ARIA, focus management, semantic review | | |
| 4 | Invoke `drupal-planner` with module description | Architecture plan (may prompt for more context) | | |

## Test 4: Cross-Org Isolation

| Check | Expected | Actual | Pass? |
|-------|----------|--------|-------|
| Zivtech user cannot see Milk Jawn bundles | No cross-org visibility | | |
| Milk Jawn user cannot see Zivtech-internal skills | drupal-planner not visible | | |
| Admin in both orgs sees full-bundle in each | Full access in both | | |

## Failure Modes to Check

| Scenario | Expected Behavior |
|----------|-------------------|
| Skill references a CLI tool (Read/Grep) | Graceful fallback — asks user for content |
| Skill references an unavailable MCP (axe-core) | Provides guidance without tool, no error |
| Very large skill (>700 lines) | Loads and executes without truncation |
| User not assigned a bundle | No skills visible, no errors |

## Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| QA Tester | | | |
| Admin (Zivtech) | | | |
| Admin (Milk Jawn) | | | |
