# WP02 Admin Runbook: Connector Setup

**Feature**: 003-skill-mcp-distribution  
**Work Package**: WP02 - First-Party MCP Connector Setup  
**Last Updated**: 2026-03-10

## Scope

This runbook covers org-level configuration of first-party connectors in Cowork for:

- Zivtech
- Milk Jawn

Connectors in scope:

- Atlassian
- Slack
- Google Workspace
- Figma
- Notion
- Playwright

## Prerequisites

- Admin access in each Cowork org.
- Admin credentials for each external service.
- Decision on which connectors are in-scope for each org.

## Baseline Procedure (Per Connector)

1. Go to `claude.ai/settings/connectors` in the target org.
2. Add connector from catalog.
3. Complete OAuth with service admin account.
4. Set minimum required scopes.
5. Enable connector for all users or target group.
6. Validate with a basic prompt from admin account.
7. Record status in the matrix below.

## Org Setup Matrix

| Org | Connector | Enabled (Y/N) | Scope Profile | Admin Validation Prompt | Status |
|---|---|---|---|---|---|
| Zivtech | Atlassian | | | List recent Jira issues | |
| Zivtech | Slack | | | Search Slack for "release" | |
| Zivtech | Google Workspace | | | List recent Drive files | |
| Zivtech | Figma | | | Get metadata for known file | |
| Zivtech | Notion | | | Search Notion for roadmap | |
| Zivtech | Playwright | | | Capture homepage and summarize | |
| Milk Jawn | Atlassian | | | List recent Jira issues | |
| Milk Jawn | Slack | | | Search Slack for "operations" | |
| Milk Jawn | Google Workspace | | | List recent Drive files | |
| Milk Jawn | Figma | | | Get metadata for known file | |
| Milk Jawn | Notion | | | Search Notion for strategy | |
| Milk Jawn | Playwright | | | Capture homepage and summarize | |

## Recommended Scope Profiles

Use least-privilege scopes and expand only when required.

- Atlassian: Jira read + Confluence read
- Slack: channels read + user read + search read
- Google Workspace: Drive read + Docs read/write + Sheets read + Calendar read
- Figma: file and metadata read
- Notion: read pages/databases in approved workspace
- Playwright: standard connector permissions for web capture/testing

## Milk Jawn Service Gaps

If a service is not used by Milk Jawn, mark as `N/A` and record rationale.

| Service | N/A Rationale | Approved By | Date |
|---|---|---|---|
| Atlassian | | | |
| Figma | | | |
| Notion | | | |
| Playwright | | | |

## Hand-off to Verification (T012)

After admin setup is complete:

1. Execute non-admin validation using [wp02-connector-verification.md](../verification/wp02-connector-verification.md).
2. For failures, capture exact error and impacted org/connector.
3. Resolve and re-run failed cases until all applicable connectors pass.
