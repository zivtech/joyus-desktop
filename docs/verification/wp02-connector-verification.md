# WP02 Connector Verification Report

**Feature**: 003-skill-mcp-distribution  
**Work Package**: WP02 - First-Party MCP Connector Setup  
**Verification Date**: 2026-03-10  
**Status**: In Progress

## Goal

Verify each configured first-party connector responds to tool calls from a non-admin user in each org.

## Preconditions

- [ ] Zivtech connectors configured and active in Cowork admin.
- [ ] Milk Jawn connectors configured and active in Cowork admin.
- [ ] At least one non-admin user test account per org.
- [ ] OAuth consent completed by each test user for each connector in scope.

## Test Accounts

| Org | Test User | Role | Admin? |
|---|---|---|---|
| Zivtech | _TBD_ | PM/Operations | No |
| Milk Jawn | _TBD_ | Operations/Leadership | No |

## Connector Coverage Matrix

Mark a connector as N/A only if the org does not use that service.

| Connector | Zivtech | Milk Jawn | Notes |
|---|---|---|---|
| Atlassian | Pending | Pending | |
| Slack | Pending | Pending | |
| Google Workspace | Pending | Pending | |
| Figma | Pending | Pending | |
| Notion | Pending | Pending | |
| Playwright | Pending | Pending | |

## Zivtech Non-Admin Verification

| Connector | Test Prompt | Expected | Actual Result Summary | Pass/Fail | Timestamp |
|---|---|---|---|---|---|
| Atlassian | List my recent Jira issues | Real Jira issues returned, no auth error | | | |
| Slack | Search Slack for "release notes" | Real Slack results returned | | | |
| Google Workspace | List my recent Google Drive files | Real Drive file list returned | | | |
| Figma | Get metadata for `<known-file-url>` | Real file metadata returned | | | |
| Notion | Search Notion for "roadmap" | Real Notion pages/databases returned | | | |
| Playwright | Capture `https://example.com` and summarize | Page captured and summary produced | | | |

## Milk Jawn Non-Admin Verification

| Connector | Test Prompt | Expected | Actual Result Summary | Pass/Fail | Timestamp |
|---|---|---|---|---|---|
| Atlassian | List my recent Jira issues | Real Jira issues returned OR N/A if unused | | | |
| Slack | Search Slack for "operations update" | Real Slack results returned | | | |
| Google Workspace | List my recent Google Drive files | Real Drive file list returned | | | |
| Figma | Get metadata for `<known-file-url>` | Real file metadata returned OR N/A if unused | | | |
| Notion | Search Notion for "quarterly plan" | Real Notion data returned OR N/A if unused | | | |
| Playwright | Capture `https://example.com` and summarize | Tool call succeeds OR N/A by policy | | | |

## Failed Cases Log

| Org | Connector | Error | Repro Steps | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|

## Evidence Links

- Zivtech session transcript/screenshots: _TBD_
- Milk Jawn session transcript/screenshots: _TBD_
- Admin connector status screenshots: _TBD_

## SC-002 Check

- [ ] Atlassian functional for applicable org users.
- [ ] Slack functional for applicable org users.
- [ ] Google functional for applicable org users.
- [ ] Additional connectors (Figma/Notion/Playwright) validated where configured.

## Sign-off

| Role | Name | Date | Decision |
|---|---|---|---|
| WP02 Implementer | | | |
| Org Admin (Zivtech) | | | |
| Org Admin (Milk Jawn) | | | |
