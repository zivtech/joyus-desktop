---
work_package_id: WP09
title: Governance & Telemetry Integration
lane: "for_review"
dependencies: []
subtasks:
- T048
- T049
- T050
- T051
- T052
- T069
phase: Phase 2 - Desktop Companion
assignee: ''
agent: "claude-opus"
shell_pid: "99816"
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-03-10T00:00:00Z'
  lane: planned
  agent: ''
  action: Prompt generated
---

# Work Package Prompt: WP09 - Governance & Telemetry Integration

## Objective

Connect local MCP servers managed by the desktop companion to the governance/policy framework (from feature 001) and the telemetry pipeline (from WP05), so admins can enforce tool-blocking policies and see local MCP usage in the same reports as Cowork/CLI usage.

## Context

Feature 001 implemented runtime policy enforcement with an authorization matrix (allow/deny/escalate). WP05 built the telemetry pipeline with event schema, aggregation endpoint, and admin reports. This WP wires local MCP servers into both systems. Governance means admin can block specific tools or enable audit mode. Telemetry means local MCP events appear alongside Cowork and CLI events in admin reports.

**Dependencies**: WP07 (local MCPs running), WP05 (telemetry pipeline exists)
**Requirements**: FR-012, FR-013

## Subtasks

### T048: Connect local MCP governance to feature 001 policy enforcement

**Purpose**: Local MCP servers must respect the same tool-blocking and audit policies as cloud services (FR-013).

**Steps**:
1. Review feature 001's policy enforcement architecture:
   - Read `kitty-specs/001-desktop-runtime-policy-enforcement/` for the authorization matrix design
   - Understand how policy decisions flow: control plane → companion → enforcement point
   - Identify the policy check function signature and integration points
2. Determine how local MCP servers receive policy decisions:
   - **Option A**: Companion fetches policy from control plane on startup, passes to MCP servers via environment or config
   - **Option B**: MCP servers call a local governance endpoint (companion acts as proxy)
   - **Option C**: Policy embedded in `@zivtech-mcp/shared` governance module, refreshed periodically
3. Integrate policy check into MCP server request handlers:
   ```typescript
   // In each MCP server's tool handler:
   async function handleToolCall(toolName: string, args: any) {
     const decision = await governance.checkPolicy(toolName, context);
     if (decision === 'deny') {
       return { error: { code: -32600, message: `Tool "${toolName}" blocked by policy` } };
     }
     if (decision === 'audit') {
       governance.logAuditEvent(toolName, context);
     }
     // Proceed with tool execution
     return await executeTool(toolName, args);
   }
   ```
4. Handle policy outcomes:
   - **allow**: Proceed normally
   - **deny**: Return MCP error response with clear message, do NOT execute the tool
   - **audit**: Execute the tool but generate an audit log entry
   - **escalate**: Return "needs approval" response (if applicable to local tools)
5. Policy refresh: companion fetches updated policy every sync cycle (6 hours) or on demand.

**Files**: `packages/mcp-registry/src/governance-integration.ts`, updates to `packages/shared/src/governance.ts` in zivtech-mcp-tools

**Validation**: Blocked tool returns policy error (not execution result). Audit-mode tool executes but generates log entry. Policy update takes effect within one sync cycle. MCP server stays running after any policy outcome.

---

### T049: Route local telemetry through @zivtech-mcp/shared pipeline to control plane

**Purpose**: Local MCP tool calls generate telemetry events in the same format as Cowork/CLI events (FR-012).

**Steps**:
1. Verify `@zivtech-mcp/shared` telemetry collector is properly wired (should be fixed in WP06 T036).
2. Configure the telemetry endpoint in local MCP servers:
   - Set `TELEMETRY_ENDPOINT` to the aggregation endpoint from WP05
   - Set `TELEMETRY_API_KEY` for authentication
   - Companion injects these as environment variables when spawning MCP server processes
3. Add channel identifier to events from local MCPs:
   ```typescript
   const event: TelemetryEvent = {
     ...baseEvent,
     channel: "desktop",  // Distinguishes from "cowork" and "cli"
   };
   ```
4. Ensure events include:
   - MCP server name (e.g., "axe-core")
   - Tool name (e.g., "run_accessibility_scan")
   - Duration (ms)
   - Outcome (success/failure/timeout)
5. Test: make a local MCP tool call → verify event appears in aggregation endpoint with `channel: "desktop"`.

**Files**: `packages/mcp-registry/src/telemetry-integration.ts`, environment configuration for spawned MCP processes

**Validation**: Local MCP tool calls generate telemetry events. Events arrive at aggregation endpoint with `channel: "desktop"`. Event schema matches WP05 definition.

---

### T050: Make governance mode (off/audit/enforce) remotely configurable by admin

**Purpose**: Admin can change governance behavior without touching individual machines.

**Steps**:
1. Define governance modes:
   - **off**: No policy checks performed. Tools execute freely.
   - **audit**: Policy checks run, denials are LOGGED but NOT enforced. All tools execute.
   - **enforce**: Policy checks run, denials ARE enforced. Blocked tools return errors.
2. Add governance mode to the central config:
   ```json
   // In distribution-config.json or separate governance-config.json
   {
     "governance": {
       "mode": "audit",
       "updated_at": "2026-03-10T00:00:00Z"
     }
   }
   ```
3. Companion reads governance mode on startup and on each periodic sync (same 6-hour cycle).
4. Pass governance mode to MCP servers:
   - Environment variable: `GOVERNANCE_MODE=audit`
   - Or config file read by `@zivtech-mcp/shared`
5. Mode change takes effect on next sync cycle — no companion restart required.
6. Optionally: show current mode in companion system tray ("Governance: Audit Mode").

**Files**: Config extension, `packages/mcp-registry/src/governance-integration.ts`

**Validation**: Admin sets mode to "enforce" → tools are blocked per policy. Set to "audit" → tools execute but are logged. Set to "off" → no checks. Mode change propagates within one sync cycle.

---

### T051: Verify tool blocking works in enforce mode

**Purpose**: Validate that governance enforcement actually prevents tool execution.

**Steps**:
1. Set governance mode to "enforce" in the config.
2. Configure a policy rule that blocks a specific tool:
   - e.g., block `screenshot__capture` or `axe-core__run_scan`
3. Wait for companion to pick up the config (or restart).
4. In Claude Code, attempt to call the blocked tool.
5. Verify:
   - [ ] Tool returns a policy error message (not a result)
   - [ ] Error message clearly states the tool is blocked by policy
   - [ ] MCP server stays running (doesn't crash)
   - [ ] An audit/governance event is generated for the blocked call
6. Unblock the tool (remove from deny list).
7. Verify the tool now works again.
8. Test edge case: what happens if ALL tools on a server are blocked?

**Files**: `docs/verification/wp09-governance-verification.md`

**Validation**: Blocked tool returns clear policy error. Server stays running. Audit event generated. Unblocking restores access.

---

### T052: Verify telemetry events from local MCPs appear in admin report

**Purpose**: End-to-end verification that local MCP telemetry flows through the full pipeline.

**Steps**:
1. Make several local MCP tool calls:
   - axe-core scan (expect success)
   - lighthouse report (expect success)
   - screenshot capture (expect success)
   - Deliberately trigger a failure (invalid URL) (expect failure event)
2. Wait for events to propagate (up to 60s for batched events).
3. Query the aggregation endpoint directly — verify events exist with:
   - `channel: "desktop"`
   - Correct tool names
   - Correct outcomes (success/failure)
   - Accurate timestamps and durations
4. Generate admin usage report (WP05 T028 report tool).
5. Verify local MCP events appear in the report:
   - Desktop channel listed
   - Event counts match actual calls
   - Correct org attribution
6. Test opt-out: enable telemetry opt-out → make tool call → verify NO event generated.

**Files**: `docs/verification/wp09-telemetry-verification.md`

**Validation**: Admin report includes desktop MCP events. Counts match actuals. Channel shows "desktop". Opt-out prevents event generation.

### T069: Tests for governance and telemetry integration (Constitution 2.5)

**Purpose**: Achieve 100% coverage on governance and telemetry integration code per constitution mandate.

**Steps**:
1. Create test files:
   - `packages/mcp-registry/src/__tests__/governance-integration.test.ts`
   - `packages/mcp-registry/src/__tests__/telemetry-integration.test.ts`
2. Governance tests:
   - Policy check returns allow → tool executes
   - Policy check returns deny → tool blocked, error returned
   - Policy check returns audit → tool executes, audit event logged
   - Governance check throws → fail-closed in enforce mode, proceed in audit mode
   - Mode switching (off/audit/enforce)
3. Telemetry tests:
   - Event emitted with correct schema (channel: "desktop")
   - Endpoint unreachable → event buffered locally
   - Opt-out flag → no events emitted
   - Batch event submission
4. Verify: 100% coverage on governance and telemetry integration modules.

**Files**: `packages/mcp-registry/src/__tests__/governance-integration.test.ts`, `packages/mcp-registry/src/__tests__/telemetry-integration.test.ts`

**Validation**: 100% coverage on both modules. All policy outcomes and telemetry paths tested.

---

## Implementation Notes

- **Feature 001 reuse**: The authorization matrix and policy framework are already built. Don't duplicate — import or call into the existing enforcement module.
- **`@zivtech-mcp/shared`**: This package should already have governance hooks and telemetry infrastructure. This WP wires the config and endpoints, not the logic.
- **Governance mode**: Start simple — a single JSON field. Complex per-tool per-user policies can come later.
- **Telemetry opt-out vs governance audit**: These are separate concerns. A user can opt out of telemetry (no usage events sent) but governance audit logs are org-controlled and NOT affected by user opt-out. Governance logs are for compliance, not analytics.
- **Environment variables**: The companion sets env vars when spawning MCP processes. This is the cleanest way to pass config without modifying MCP server code significantly.

## Done Criteria

- [ ] Local MCPs enforce policies from feature 001 framework (T048)
- [ ] Local MCP telemetry flows to aggregation endpoint with "desktop" channel (T049)
- [ ] Governance mode (off/audit/enforce) remotely configurable (T050)
- [ ] Tool blocking verified in enforce mode (T051)
- [ ] Local MCP events appear in admin usage report (T052)
- [ ] 100% test coverage on governance/telemetry integration (T069) — constitution 2.5 mandatory

## Risks & Edge Cases

- **Feature 001 API evolution**: Policy format may evolve — use an adapter layer
- **Telemetry endpoint unreachable**: Buffer events locally, retry later (don't lose data)
- **Governance check during active request**: Apply mode on next request, not mid-execution
- **Opt-out vs governance audit**: Telemetry opt-out should NOT disable governance audit logging (org requirement)
- **Policy denies dependency**: Tool A calls Tool B, Tool B is blocked → Tool A fails gracefully with clear error
- **Config sync race**: Governance mode update arrives while MCP server is processing a request — safe because mode is checked per-request

## Implementation Command

```bash
spec-kitty implement WP09 --base WP07
```

## Activity Log

- 2026-03-10: Prompt generated in planned lane.
- 2026-03-12T02:12:08Z – claude-opus – shell_pid=99816 – lane=doing – Started implementation via workflow command
- 2026-03-12T11:18:32Z – claude-opus – shell_pid=99816 – lane=for_review – mcp-governance package: 52 tests, all passing
