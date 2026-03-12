# WP11 — Recommended Next Steps (T064)

**Feature**: 003 - Skill MCP Distribution
**Last Updated**: _______________
**Author**: _______________

---

## Immediate — Next 2 Weeks

Actions to take immediately following Phase 2 verification and project closeout.

### NS-001: Monitor Telemetry for Adoption Gaps

**Priority**: P0
**Owner**: _______________
**Description**: Review telemetry dashboards daily for the first two weeks post-rollout. Identify users who have not invoked any skills or used any MCP connectors. Reach out proactively to understand blockers.
**Success Metric**: > 80% of target users have at least one skill invocation within the first week.
**Depends On**: WP05 telemetry pipeline, WP09 governance telemetry.

### NS-002: Address User Feedback

**Priority**: P0
**Owner**: _______________
**Description**: Triage feedback from the user survey (T063). Categorize into: quick fixes (address now), short-term improvements (backlog), and long-term requests (roadmap). Address any quick fixes within two weeks.
**Success Metric**: All "immediate action" items from user-feedback-summary.md resolved.
**Depends On**: T063 feedback collection complete.

### NS-003: Fix Blocking Issues from Phase 2 Tester Verification

**Priority**: P0
**Owner**: _______________
**Description**: Resolve any critical or major issues documented in the T062 blocking issues log. Re-verify with affected testers. Update the desktop companion release with fixes.
**Success Metric**: Zero unresolved critical or major issues in wp11-desktop-tester-results.md.
**Depends On**: T062 tester results.

### NS-004: Communicate Rollout to Wider Audience

**Priority**: P1
**Owner**: _______________
**Description**: After initial rollout group is stable, prepare communication for broader org audiences. Include: what's available, how to get started, where to get help. Use Slack announcements, email, and team meetings.
**Deliverable**: Rollout communication sent to all Zivtech and Milk Jawn team members.

---

## Short-Term — 1 to 3 Months

Improvements planned for the near future based on known limitations and anticipated demand.

### NS-005: Windows Desktop Companion Support

**Priority**: P1
**Owner**: _______________
**Description**: Port the desktop companion to Windows. This requires: Windows installer (MSI or NSIS), Windows code signing, Windows-specific path handling, Windows service management for MCP servers, and testing on Windows 10/11.
**Addresses**: L-006 (macOS only).
**Effort Estimate**: 2-3 weeks.
**Dependencies**: Electron/Tauri Windows build pipeline.

### NS-006: Unified Telemetry Opt-Out Across Channels

**Priority**: P1
**Owner**: _______________
**Description**: Implement a single opt-out preference that propagates across Cowork, CLI, and desktop companion. Store the preference in the control plane and sync it to each channel on session start.
**Addresses**: L-003 (per-channel opt-out).
**Effort Estimate**: 1 week.
**Dependencies**: Control plane API for preference storage.

### NS-007: Skill Authoring Guide for Internal Developers

**Priority**: P2
**Owner**: _______________
**Description**: Write a guide for Zivtech developers who want to create new skills for distribution. Cover: skill format, testing locally, submitting for review, bundle assignment, and version management.
**Deliverable**: `docs/developer-guides/skill-authoring.md`
**Effort Estimate**: 2-3 days.

### NS-008: Enhanced Admin Dashboard with Visual Charts

**Priority**: P2
**Owner**: _______________
**Description**: Upgrade the telemetry reporting from text-based tables to visual charts. Include: usage trends over time, per-org comparisons, skill popularity rankings, and connector health status.
**Addresses**: DF-004 (health dashboard, partially).
**Effort Estimate**: 1-2 weeks.
**Dependencies**: Charting library selection, dashboard hosting.

### NS-009: Automatic MCP Server Recovery

**Priority**: P1
**Owner**: _______________
**Description**: Add process supervision to the desktop companion so that crashed MCP servers are automatically restarted with exponential backoff. Include crash telemetry to identify unstable servers.
**Addresses**: L-010 (no automatic recovery).
**Effort Estimate**: 3-5 days.

### NS-010: Bundled Node.js Runtime

**Priority**: P2
**Owner**: _______________
**Description**: Bundle a Node.js runtime with the desktop companion installer so users do not need to install Node.js separately. Use a minimal runtime or compile MCP servers to standalone executables.
**Addresses**: L-007 (Node.js requirement).
**Effort Estimate**: 1 week.

---

## Medium-Term — 3 to 6 Months

Strategic improvements that expand the platform's capabilities.

### NS-011: Per-User Granular Permissions

**Priority**: P2
**Owner**: _______________
**Description**: Allow admins to assign individual skills (not just bundles) to users. Support permission inheritance: org defaults, bundle overrides, user-level overrides. Build an admin UI for managing assignments.
**Addresses**: DF-001.
**Effort Estimate**: 3-4 weeks.

### NS-012: Custom Skill Marketplace for Organizations

**Priority**: P2
**Owner**: _______________
**Description**: Create an internal marketplace where org members can discover, request, and install skills beyond their default bundle. Includes: skill catalog with descriptions, request/approval workflow, and usage ratings.
**Effort Estimate**: 4-6 weeks.

### NS-013: MCP Server Health Monitoring and Alerting

**Priority**: P2
**Owner**: _______________
**Description**: Implement comprehensive health monitoring for all MCP servers (local and cloud). Include: uptime tracking, request latency percentiles, error rates, and alerting (email/Slack) when a server degrades.
**Addresses**: DF-004.
**Effort Estimate**: 2-3 weeks.

### NS-014: Automated Regression Testing for Skill Updates

**Priority**: P2
**Owner**: _______________
**Description**: Build a CI pipeline that runs skill evaluation tests (using eval-runner MCP) whenever skills are updated. Catch regressions before new versions are pinned and distributed.
**Effort Estimate**: 2 weeks.
**Dependencies**: eval-runner MCP server (from zivtech-mcp-tools).

### NS-015: Hosted MCP Relay for Browser-Dependent Tools

**Priority**: P3
**Owner**: _______________
**Description**: Deploy a server-side relay that exposes axe-core, lighthouse, and screenshot MCPs over HTTP. This allows Cowork web users to access these tools without installing the desktop companion.
**Addresses**: DF-005, L-001.
**Effort Estimate**: 4-6 weeks (includes security review, infrastructure provisioning, and rate limiting).
**Dependencies**: Server infrastructure, security review.

---

## Project Metrics

Track these metrics to measure the success of the rollout and guide prioritization of next steps. To be filled in after the rollout stabilizes (approximately 2-4 weeks post-launch).

### Adoption Metrics

| Metric | Value | Date Measured | Notes |
|--------|-------|:------------:|-------|
| Total target users | | | |
| Users with at least 1 skill invocation | | | |
| Adoption rate (%) | | | |
| Active users (past 7 days) | | | |
| Active users by org — Zivtech | | | |
| Active users by org — Milk Jawn | | | |

### Usage Metrics

| Metric | Value | Date Measured | Notes |
|--------|-------|:------------:|-------|
| Total skill invocations (all time) | | | |
| Skill invocations (past 7 days) | | | |
| Most-used skill | | | |
| Least-used skill (among distributed) | | | |
| Total MCP tool calls (all time) | | | |
| MCP tool calls (past 7 days) | | | |
| Most-used MCP connector | | | |

### Reliability Metrics

| Metric | Value | Date Measured | Notes |
|--------|-------|:------------:|-------|
| Companion uptime (%) during rollout | | | |
| MCP server crash count | | | |
| Failed tool calls (%) | | | |
| Avg install-to-working time | | | Target: < 5 min |
| Sync failures (CLI) | | | |

### Satisfaction Metrics

| Metric | Value | Date Measured | Notes |
|--------|-------|:------------:|-------|
| Avg ease-of-use rating (Q1) | | | Scale: 1-5 |
| Avg overall experience rating (Q6) | | | Scale: 1-5 |
| Would recommend (%) | | | From Q7 |
| NPS (approximate) | | | |

---

## Prioritization Matrix

Summary of all next steps ranked by priority and effort:

| ID | Next Step | Priority | Effort | Timeline | Status |
|----|-----------|:--------:|:------:|:--------:|:------:|
| NS-001 | Monitor telemetry for adoption gaps | P0 | Low | Immediate | Not Started |
| NS-002 | Address user feedback | P0 | Medium | Immediate | Not Started |
| NS-003 | Fix Phase 2 blocking issues | P0 | Variable | Immediate | Not Started |
| NS-004 | Communicate to wider audience | P1 | Low | Immediate | Not Started |
| NS-005 | Windows companion support | P1 | High | 1-3 months | Not Started |
| NS-006 | Unified telemetry opt-out | P1 | Medium | 1-3 months | Not Started |
| NS-007 | Skill authoring guide | P2 | Low | 1-3 months | Not Started |
| NS-008 | Enhanced admin dashboard | P2 | Medium | 1-3 months | Not Started |
| NS-009 | Automatic MCP server recovery | P1 | Medium | 1-3 months | Not Started |
| NS-010 | Bundled Node.js runtime | P2 | Medium | 1-3 months | Not Started |
| NS-011 | Per-user granular permissions | P2 | High | 3-6 months | Not Started |
| NS-012 | Custom skill marketplace | P2 | High | 3-6 months | Not Started |
| NS-013 | MCP health monitoring & alerting | P2 | Medium | 3-6 months | Not Started |
| NS-014 | Automated regression testing | P2 | Medium | 3-6 months | Not Started |
| NS-015 | Hosted MCP relay | P3 | High | 3-6 months | Not Started |

---

*This document should be reviewed monthly and updated as next steps are completed or re-prioritized.*
