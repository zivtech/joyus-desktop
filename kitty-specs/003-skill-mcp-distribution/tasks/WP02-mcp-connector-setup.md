---
work_package_id: "WP02"
title: "First-Party MCP Connector Setup"
lane: "for_review"
dependencies: []
subtasks:
  - "T006"
  - "T007"
  - "T008"
  - "T009"
  - "T010"
  - "T011"
  - "T012"
phase: "Phase 1 - Cowork Distribution"
assignee: ""
agent: "codex"
shell_pid: "62606"
review_status: ""
reviewed_by: ""
history:
  - timestamp: "2026-03-10T00:00:00Z"
    lane: "planned"
    agent: ""
    action: "Prompt generated"
---

# Work Package Prompt: WP02 - First-Party MCP Connector Setup

## Objective

Configure Anthropic-managed first-party MCP connectors (Atlassian, Slack, Google, Figma, Notion, Playwright) at the org level for both Zivtech and Milk Jawn Cowork workspaces, enabling all org users to access external tools without local setup.

## Context

First-party cloud MCPs are the highest-value, lowest-friction capability for non-developers. Admin configures connectors once at `claude.ai/settings/connectors`, and all org users get access (with per-user OAuth consent on first use). These are HTTP/SSE transport — no local install needed.

**Target services**: Atlassian (Jira/Confluence), Slack, Google Workspace, Figma, Notion, Playwright
**Target orgs**: Zivtech, Milk Jawn
**Requirements**: FR-002, SC-002

## Subtasks

### T006: Configure Atlassian connector for Zivtech org

**Purpose**: Enable Jira/Confluence access for all Zivtech Cowork users (FR-002).

**Steps**:
1. Navigate to Zivtech Cowork admin settings → Connectors.
2. Add Atlassian connector from the connector catalog.
3. Complete OAuth flow with Zivtech Atlassian admin credentials.
4. Set scope: read Jira issues, read Confluence pages (adjust based on available scopes).
5. Enable connector for all org users (or specific groups if supported).
6. Test: as admin, ask Claude to list Jira issues — verify it uses the Atlassian MCP.

**Validation**: Connector shows as "Active" in admin panel. Admin can query Jira issues through Claude.

---

### T007: Configure Slack connector for Zivtech org

**Purpose**: Enable Slack search and channel reading for Zivtech users.

**Steps**:
1. Add Slack connector in Cowork admin.
2. Complete OAuth with Zivtech Slack workspace admin.
3. Set appropriate scopes (channels:read, search:read, users:read, etc.).
4. Enable for org users.
5. Test: ask Claude to search Slack for a known term — verify results returned.

**Validation**: Slack connector active. Test search returns real Slack data.

---

### T008: Configure Google Workspace connector for Zivtech org

**Purpose**: Enable Google Drive, Docs, Sheets, Calendar access.

**Steps**:
1. Add Google Workspace connector.
2. Complete OAuth with Zivtech Google Workspace admin.
3. Set scopes: Drive (read), Docs (read/write), Sheets (read), Calendar (read).
4. Enable for org users.
5. Test: ask Claude to list recent Google Drive files — verify results.

**Validation**: Google connector active. Drive, Docs, Sheets accessible through Claude.

---

### T009: Configure connectors for Milk Jawn org

**Purpose**: Replicate applicable connector setup for Milk Jawn workspace.

**Steps**:
1. Switch to Milk Jawn Cowork admin panel.
2. Determine which services Milk Jawn uses:
   - Atlassian: configure if Milk Jawn has Jira/Confluence (may not)
   - Slack: configure for Milk Jawn Slack workspace
   - Google Workspace: configure for Milk Jawn Google account
3. Configure each applicable connector following the same process as T006-T008.
4. Skip connectors for services Milk Jawn doesn't use — document which and why.
5. Test each configured connector from a Milk Jawn user account.

**Validation**: All applicable connectors configured for Milk Jawn. Skipped connectors documented with rationale.

---

### T010: Configure additional connectors (Figma, Notion, Playwright)

**Purpose**: Enable remaining first-party connectors as prioritized by each org.

**Steps**:
1. Assess which additional connectors each org needs:
   - **Figma**: Zivtech uses Figma for design work — high priority for Zivtech.
   - **Notion**: Check if either org uses Notion — configure if yes.
   - **Playwright**: Web testing connector — useful for developers in Cowork.
2. Configure Figma connector for Zivtech:
   - OAuth with Figma admin.
   - Set appropriate scopes (read designs, read components).
3. Configure Notion connector if applicable.
4. Configure Playwright connector if applicable.
5. Document priority and availability per org.

**Validation**: Each configured connector responds to tool calls. Priority-based configuration documented.

---

### T011: Document OAuth consent flow for end users

**Purpose**: Create user-facing guide so non-technical users know what to expect when first using a connector.

**Steps**:
1. For each configured connector, walk through the first-use experience as a non-admin user:
   - What does the OAuth consent dialog look like?
   - What permissions are requested?
   - How long does the flow take?
2. Capture screenshots of each consent dialog.
3. Write a user-friendly guide covering:
   - What happens when you first use a connector (OAuth prompt)
   - What permissions you're granting and why
   - That this is one-time per connector
   - What to do if the consent fails or times out
   - What to do if you need to re-authorize (token expiry)
4. Create FAQ section for common issues.
5. Publish to internal docs (Confluence or shared Google Doc).

**Files**: `docs/user-guides/mcp-connector-oauth-guide.md`

**Validation**: Guide covers all configured connectors. A non-technical user can follow it without assistance.

---

### T012: Verify each connector responds to tool calls from a non-admin user

**Purpose**: End-to-end verification of all configured connectors from actual target users (SC-002 partial).

**Steps**:
1. Log in as a non-admin user in Zivtech Cowork.
2. For each configured connector, issue a simple tool call:
   - Atlassian: "List my recent Jira issues"
   - Slack: "Search Slack for [known term]"
   - Google: "List my recent Google Drive files"
   - Figma: "Get metadata for [known Figma file]"
   - (Any others configured)
3. Verify each response contains real data (not an error).
4. Repeat for a Milk Jawn non-admin user with their org's connectors.
5. Document results: connector name, org, test query, result (pass/fail), notes.

**Files**: `docs/verification/wp02-connector-verification.md`

**Validation**: Every configured connector verified working for non-admin user in each org. All results documented.

## Implementation Notes

- This is primarily admin UI work, not code. The bulk is Cowork admin panel configuration and OAuth flows.
- Each connector requires admin credentials for the underlying service (Jira admin, Slack workspace admin, Google admin). Coordinate access before starting.
- Connector configuration in claude.ai automatically syncs to Claude Code for users signed in with the same account — this is a bonus, not a requirement.
- Milk Jawn may not use all the same services — only configure what's relevant. Don't force connectors for unused services.

## Done Criteria

- [ ] Atlassian, Slack, Google configured for Zivtech org (T006-T008)
- [ ] Applicable connectors configured for Milk Jawn org (T009)
- [ ] Additional connectors configured as prioritized (T010)
- [ ] OAuth consent flow documented for end users (T011)
- [ ] All connectors verified working from non-admin accounts (T012)

## Risks & Edge Cases

- **OAuth token expiry**: Tokens may expire mid-session — document re-authorization flow for users
- **Per-user consent**: Some connectors may require individual OAuth even when org-configured
- **Service unavailability**: If Atlassian/Slack/Google is down during setup, retry later
- **Milk Jawn service gaps**: Milk Jawn may not have Atlassian — skip gracefully
- **Rate limits**: Connector API calls may be rate-limited — understand limits and document for users
- **Dual-org users**: User in both orgs may see connectors from both — verify no conflicts

## Implementation Command

```bash
spec-kitty implement WP02
```

## Activity Log

- 2026-03-10: Prompt generated in planned lane.
- 2026-03-11T00:29:33Z – codex – shell_pid=62606 – lane=doing – Started WP02 implementation in repository
- 2026-03-12T01:59:28Z – codex – shell_pid=62606 – lane=for_review – Ready: Connector setup runbook, OAuth user guide, verification checklist for both orgs.
