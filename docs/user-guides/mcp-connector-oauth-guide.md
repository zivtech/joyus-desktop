# MCP Connector OAuth Guide (Cowork)

**Audience**: Non-admin Cowork users at Zivtech and Milk Jawn  
**Applies to**: Atlassian, Slack, Google Workspace, Figma, Notion, Playwright  
**Last Updated**: 2026-03-10

## What This Is

When your org admin enables a connector in Cowork, you may still need to grant one-time consent the first time you use that connector. This guide explains what to expect and what to do if authorization fails.

## Before You Start

- Confirm your admin has enabled the connector for your org.
- Make sure you are logged into the correct account for the external service (Slack, Google, etc.).
- Keep pop-up blockers disabled for `claude.ai` during consent.

## First-Use Flow (All Connectors)

1. Ask Claude to perform an action that requires a connector (for example, "List my recent Jira issues").
2. Cowork prompts you to connect/authorize that service.
3. You are redirected to the service OAuth page.
4. Review requested permissions and approve.
5. You are returned to Cowork.
6. Repeat your original request; the connector should now run.

## Connector Reference

| Connector | Typical Prompt | Typical Permissions Requested | Re-Auth Trigger |
|---|---|---|---|
| Atlassian | "List my recent Jira issues" | Read Jira issues, read Confluence pages | Token expiry, admin scope change |
| Slack | "Search Slack for release notes" | Read channels, users, search history | Token expiry, workspace app reinstall |
| Google Workspace | "List my recent Drive files" | Read Drive files, Docs/Sheets access, Calendar access | Token expiry, Google security reset |
| Figma | "Get metadata for file <URL>" | Read files, nodes, components metadata | Token expiry, team permission changes |
| Notion | "Search Notion for roadmap" | Read pages/databases in connected workspace | Integration scope updates |
| Playwright | "Capture homepage and summarize issues" | Playwright session permissions in connector runtime | Connector reset/redeployment |

## What You Are Granting

- Access is scoped to the connector and permissions approved in OAuth.
- Access is not global to every app by default; each connector is separate.
- If your org policy allows, you can revoke access from your external account security settings.

## If Consent Fails

1. Retry once in a new browser tab.
2. Confirm you used the correct org account (for example, company Slack vs personal Slack).
3. Sign out and sign back into the external service, then retry.
4. Ask your admin to confirm connector status in `claude.ai/settings/connectors`.
5. If still failing, capture:
   - timestamp,
   - connector name,
   - exact error text,
   - your org (Zivtech or Milk Jawn),
   and send this to support/admin.

## Re-Authorization

You may be prompted again if:

- your token expires,
- admin changes connector scopes,
- the external service revokes the app,
- your account permissions change.

Re-authorization uses the same first-use flow and usually takes under 1 minute.

## FAQ

### Why do I see a consent screen if the admin already enabled connectors?

Admin enables connector availability for the org. You still grant your user-level access token on first use.

### Do I need to authorize on every session?

No. OAuth is generally one-time per connector until token expiry/revocation.

### I connected the wrong account. How do I fix it?

Disconnect/revoke the integration in the service account settings, then run the connector again in Cowork to re-authorize.

### Can I opt out of a connector?

Yes. Do not authorize it, or revoke authorization later in the external service settings.

## Admin Notes (for internal rollout owners)

- Add connector-specific screenshots under `docs/user-guides/assets/` and link them in this guide.
- Keep permission descriptions synchronized with actual scopes configured in Cowork.
