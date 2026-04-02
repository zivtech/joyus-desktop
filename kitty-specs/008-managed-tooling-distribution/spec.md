# Feature Specification: Managed Tooling Distribution

**Feature Branch**: `feat/008-managed-tooling-distribution`
**Created**: 2026-04-01
**Status**: Draft
**Input**: Joyus Desktop can distribute skill files via skill-sync, but cannot manage the full local tooling lifecycle — hooks in settings.json, MCP server entries, per-tenant policy-driven configuration, or immediate revocation. This blocks the chat-length enforcement feature and any future operator-controlled local tooling.

## Clarifications

### Session 2026-04-01

- Q: What does "immediate" revocation mean — push-based or poll-based? → A: Lightweight config-check poll on a fast interval (e.g., every 5 minutes). Control plane sets a "revocation pending" flag at the config endpoint; desktop checks that endpoint more frequently than a full sync. Full sync triggers only when something changed. No new push infrastructure required.
- Q: Where should the settings reconciler live — extend skill-sync or new package? → A: New package (`packages/settings-reconciler`). Cleaner separation of concerns; skill-sync stays focused on file distribution.
- Q: Should managed entries target global settings, project settings, or both? → A: Global (`~/.claude/settings.json`) by default, with manifest-level override to target project-level (`.claude/settings.json`).
- Q: How should managed entries be distinguished from user-authored entries? → A: Both prefix convention and sidecar registry. Managed hook/MCP names get a `joyus:` prefix for human readability. A `.claude/.joyus-managed.json` sidecar registry tracks managed entry ownership for programmatic reconciliation.

## Scope

### In Scope

- **Settings reconciler package**: A new `packages/settings-reconciler` package that reads a distribution manifest and non-destructively merges managed hooks and MCP entries into Claude Code's `settings.json` or `.mcp.json`.
- **Distribution manifest schema**: A typed manifest that declares managed skills (files), managed hooks (script path + event binding + configuration), managed MCP servers (server config), and tenant configuration parameters.
- **Hook distribution**: Managed hook scripts (shell/Node) distributed as files via skill-sync, then wired into `settings.json` hook entries by the settings reconciler.
- **MCP server management**: Add, update, and remove MCP server entries in `settings.json` or `.mcp.json` based on the distribution manifest.
- **Per-tenant configuration**: Tenant-specific values (e.g., chat length threshold, feature flags) injected into hook config files or manifest parameters. The control plane sets these per tenant/plan tier.
- **Namespace and ownership tracking**: Managed entries use a `joyus:` prefix for visibility and a `.claude/.joyus-managed.json` sidecar registry for programmatic ownership tracking.
- **Non-destructive merge**: The reconciler preserves all user-authored hooks and MCP entries. Only `joyus:`-prefixed entries in the registry are touched during reconciliation.
- **Revocation via fast config poll**: A lightweight endpoint check on a short interval detects revocation flags or config changes from the control plane, triggering a targeted sync without waiting for the next scheduled full sync.
- **Rollback on failure**: If settings reconciliation fails partway, the previous `settings.json` is restored from backup. Leverages skill-sync's existing backup infrastructure.
- **CLI integration**: The settings reconciler is callable from skill-sync's post-sync hook and independently via CLI for manual reconciliation or debugging.

### Out of Scope

- **UI for managing tooling**: No user-facing interface for browsing, enabling, or disabling managed tools. This is a future feature.
- **Runtime MCP server lifecycle**: The reconciler manages configuration entries only — it does not start, stop, or health-check MCP server processes.
- **Modifying Claude Code's hook execution engine**: The reconciler writes hook entries that Claude Code's existing engine executes. No changes to how Claude Code processes hooks.
- **Cross-machine sync**: Tooling distribution targets a single machine. Multi-device sync is a future platform concern.
- **Manifest authoring tools**: Operators write manifests by hand or via their own tooling. This feature defines the schema and consumer, not an authoring UI.

### Dependencies

- **`packages/skill-sync`**: File distribution, version pinning, integrity tracking, backup infrastructure. The settings reconciler runs as a post-sync step after skill-sync completes.
- **`packages/policy-client`**: Control plane communication for per-tenant configuration and revocation signals. The config-check poll uses policy-client's existing MCP tool contracts.
- **Claude Code hook/settings format**: The reconciler writes entries compatible with Claude Code's `settings.json` schema for hooks and MCP servers. Changes to that schema require reconciler updates.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Operator: Deploy a Chat-Length Enforcement Hook (Priority: P0)

An operator wants to deploy a hook that warns users when their session is getting long and generates a handoff note before the context window fills up. The operator publishes a distribution manifest that includes a shell script (the hook), a `pre_tool_call` binding, and a per-tenant threshold config. After the next skill-sync cycle, the hook appears in the user's `settings.json` and starts enforcing.

**Why this priority**: This is the motivating use case for the entire feature — chat-length enforcement was the conversation that spawned this spec.

**Independent Test**: End-to-end test — provide a manifest with a hook script and binding; run skill-sync followed by reconciliation; assert the hook entry appears in `settings.json` with the correct script path and event binding; assert the threshold config file contains the tenant-specific value.

**Acceptance Scenarios**:

1. **Given** a distribution manifest declaring a `joyus:chat-length-guard` hook bound to `pre_tool_call`, **When** skill-sync completes and the reconciler runs, **Then** `settings.json` contains a `pre_tool_call` hook entry with the `joyus:chat-length-guard` identifier pointing to the distributed script path.
2. **Given** the manifest includes a tenant config parameter `max_messages: 25`, **When** the reconciler processes the manifest, **Then** a config file at the expected path contains `{"max_messages": 25}` readable by the hook script.
3. **Given** the user already has personal `pre_tool_call` hooks in their `settings.json`, **When** the reconciler adds the managed hook, **Then** the user's existing hooks remain intact and the managed hook is appended (not replacing).
4. **Given** the operator updates the hook script in the next release, **When** skill-sync pulls the new version and the reconciler runs, **Then** the hook entry in `settings.json` points to the updated script and the old script is backed up.

---

### User Story 2 — Operator: Deploy a Managed MCP Server (Priority: P1)

An operator wants to distribute a custom MCP server configuration to all users in a tenant — for example, a project-specific documentation server. The manifest declares the MCP server entry with its command, args, and environment variables.

**Why this priority**: MCP servers are a primary extension point for Claude Code. Operators need to push server configurations without asking users to edit JSON files.

**Independent Test**: Integration test — provide a manifest with an MCP server entry; run reconciliation; assert the MCP entry appears in `settings.json` (or `.mcp.json`) with the correct command, args, and env.

**Acceptance Scenarios**:

1. **Given** a distribution manifest declaring a `joyus:project-docs` MCP server, **When** the reconciler runs, **Then** the MCP server entry appears in the target settings file with the declared command, args, and environment variables.
2. **Given** the user has existing MCP servers in their config, **When** the reconciler adds the managed server, **Then** existing user-configured MCP servers are untouched.
3. **Given** the manifest specifies `target: "project"` for the MCP entry, **When** the reconciler runs in a project context, **Then** the entry is written to `.claude/settings.json` (project-level) rather than `~/.claude/settings.json` (global).
4. **Given** a previously deployed MCP server is removed from the manifest, **When** the reconciler runs, **Then** the entry is removed from settings and the sidecar registry is updated.

---

### User Story 3 — Operator: Revoke a Skill Bundle After Subscription Lapse (Priority: P1)

A tenant's subscription lapses. The operator updates the distribution config at the control plane to remove the tenant's skill bundle. On the next config-check poll (within minutes), the desktop detects the change and triggers a sync that removes the managed skills, hooks, and MCP entries.

**Why this priority**: Without revocation, lapsed tenants continue using paid tooling indefinitely. This is a business requirement.

**Independent Test**: Integration test — set up a managed skill bundle with hooks and MCPs; update the remote config to remove the bundle; trigger a config poll; assert all managed entries are removed from `settings.json` and the sidecar registry, and managed files are deleted from the skills directory.

**Acceptance Scenarios**:

1. **Given** a tenant has managed skills, hooks, and MCPs deployed, **When** the control plane removes their bundle from the distribution config, **Then** the next config-check poll (within the configured interval) detects the change.
2. **Given** a config change is detected, **When** the reconciler runs with the updated manifest (or empty manifest), **Then** all `joyus:`-prefixed entries owned by the revoked bundle are removed from `settings.json`.
3. **Given** managed files were distributed via skill-sync, **When** the revocation sync runs, **Then** the files are deleted and the sync metadata reflects the removal.
4. **Given** revocation removes a hook, **When** the reconciler runs, **Then** user-authored hooks in the same event binding (e.g., other `pre_tool_call` hooks) are preserved.

---

### User Story 4 — User: Personal Settings Survive Reconciliation (Priority: P0)

A user has carefully configured personal hooks and MCP servers in their `settings.json`. The operator deploys new managed tooling. After reconciliation, every personal entry is exactly where the user left it.

**Why this priority**: If reconciliation corrupts user settings, users will lose trust and disable or work around the system. Non-destructive merge is a hard requirement.

**Independent Test**: Unit test — create a `settings.json` with user hooks and MCP servers; run reconciliation with a manifest; assert every user entry is byte-identical after reconciliation; assert only `joyus:`-prefixed entries were added.

**Acceptance Scenarios**:

1. **Given** a user has 3 personal hooks and 2 personal MCP servers, **When** the reconciler adds 2 managed hooks and 1 managed MCP, **Then** all 3 personal hooks and 2 personal MCP servers remain unchanged.
2. **Given** reconciliation fails midway (e.g., disk full, invalid JSON produced), **When** the failure is caught, **Then** the previous `settings.json` is restored from backup and no partial writes persist.
3. **Given** a user manually edits a `joyus:`-prefixed entry, **When** the next reconciliation runs, **Then** the managed entry is restored to its manifest-defined state (the user's edit is overwritten, with a backup of the modified file).
4. **Given** the sidecar registry (`.claude/.joyus-managed.json`) is missing or corrupted, **When** the reconciler runs, **Then** it rebuilds the registry by scanning for `joyus:`-prefixed entries rather than failing or removing all entries.

---

### User Story 5 — Operator: Update Tenant Configuration (Priority: P1)

An operator changes a tenant's plan tier from free to paid, increasing their chat-length threshold from 25 to 50 messages. The control plane updates the tenant config. On the next config-check poll, the desktop picks up the new values and updates the local config files.

**Why this priority**: Per-tenant configuration is what makes this a platform feature rather than a static file copier.

**Independent Test**: Integration test — deploy a hook with `max_messages: 25`; update the remote config to `max_messages: 50`; trigger config poll and reconciliation; assert the local config file reflects the new value.

**Acceptance Scenarios**:

1. **Given** a tenant config parameter changes at the control plane, **When** the config-check poll detects the change, **Then** a targeted reconciliation updates the local config file with the new value.
2. **Given** multiple config parameters exist, **When** only one changes, **Then** only the changed parameter is updated; others remain as-is.
3. **Given** the config-check endpoint is unreachable, **When** the poll fails, **Then** the existing local config is preserved and used until the next successful poll.

---

### Edge Cases

- **Corrupted settings.json**: If `settings.json` contains invalid JSON when the reconciler tries to read it, the reconciler logs a warning, creates a backup of the corrupted file, and writes a fresh file containing only the managed entries. The user is notified that their settings were corrupted and a backup was created.
- **Concurrent reconciliation**: If two sync processes trigger reconciliation simultaneously (e.g., scheduled sync + revocation poll), the file-level lock from skill-sync prevents concurrent writes. The second process waits or returns `locked` status.
- **Manifest version mismatch**: If the manifest uses a schema version newer than the reconciler understands, the reconciler skips reconciliation, preserves existing state, and logs an error recommending an update.
- **Empty manifest**: An empty or skills-only manifest (no hooks, no MCPs) results in removal of all previously managed hooks and MCPs — equivalent to a full revocation of settings entries. Managed skill files remain as long as they're in the manifest's files section.
- **Settings file doesn't exist**: If the target `settings.json` doesn't exist, the reconciler creates it with only the managed entries. This handles fresh installations.
- **Sidecar registry out of sync**: If managed entries exist in `settings.json` but not in the sidecar registry (or vice versa), the reconciler performs a consistency repair: entries with `joyus:` prefix in settings are assumed managed; registry entries without matching settings entries are pruned.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a settings reconciler that reads a distribution manifest and merges managed hook and MCP entries into Claude Code's `settings.json`, preserving all user-authored entries.
- **FR-002**: The settings reconciler MUST be implemented as a new package (`packages/settings-reconciler`), separate from `packages/skill-sync`.
- **FR-003**: The distribution manifest MUST be a typed JSON schema declaring: managed skills (file paths), managed hooks (script path, event binding, configuration), managed MCP servers (command, args, env, target scope), and tenant configuration parameters.
- **FR-004**: Managed hooks MUST be distributed as files via skill-sync and wired into `settings.json` hook entries by the settings reconciler. Each hook entry MUST include the event binding (e.g., `pre_tool_call`, `post_tool_call`) and the absolute path to the distributed script.
- **FR-005**: Managed MCP server entries MUST be added to, updated in, or removed from `settings.json` (or `.mcp.json`) based on the distribution manifest.
- **FR-006**: All managed entries MUST use a `joyus:` prefix in their identifier/name (e.g., `joyus:chat-length-guard`, `joyus:project-docs`) for human readability.
- **FR-007**: The system MUST maintain a sidecar registry at `.claude/.joyus-managed.json` that tracks all managed entry identifiers, their source bundle, and the manifest version that installed them. This registry is the programmatic source of truth for ownership.
- **FR-008**: The reconciler MUST target global settings (`~/.claude/settings.json`) by default. The manifest MAY specify `target: "project"` for individual entries, causing them to be written to `.claude/settings.json` in the current project directory.
- **FR-009**: Per-tenant configuration parameters declared in the manifest MUST be written to a config file at a deterministic path readable by hook scripts. The control plane sets parameter values per tenant/plan tier via the distribution config endpoint.
- **FR-010**: The system MUST implement a config-check poll on a configurable interval (default: 5 minutes) that queries the control plane's distribution config endpoint for changes. When a change is detected (version bump, bundle removal, parameter update), the system MUST trigger a targeted sync and reconciliation.
- **FR-011**: When the control plane removes a tenant's bundle from the distribution config, the next config-check poll MUST trigger removal of all managed skills, hooks, and MCP entries associated with that bundle.
- **FR-012**: If reconciliation fails at any point (disk error, invalid JSON produced, write failure), the system MUST restore the previous `settings.json` from a backup taken before reconciliation began. No partial writes may persist.
- **FR-013**: The reconciler MUST handle a missing or corrupted sidecar registry by rebuilding it from `joyus:`-prefixed entries found in the current `settings.json`.
- **FR-014**: The reconciler MUST handle a missing target `settings.json` by creating a new file containing only the managed entries.
- **FR-015**: The reconciler MUST handle a corrupted (invalid JSON) target `settings.json` by backing up the corrupted file and creating a fresh file with managed entries, logging a warning.
- **FR-016**: The manifest schema MUST include a `schema_version` field. If the reconciler encounters a manifest with an unrecognized schema version, it MUST skip reconciliation, preserve existing state, and log an error.
- **FR-017**: When a managed hook or MCP entry is removed from the manifest (but the bundle still exists), the reconciler MUST remove that specific entry from settings and the registry on the next reconciliation.
- **FR-018**: The settings reconciler MUST be callable as a post-sync hook from skill-sync and independently via CLI for manual reconciliation or debugging.
- **FR-019**: When multiple hook entries share the same event binding (e.g., multiple `pre_tool_call` hooks), the reconciler MUST append managed hooks alongside user hooks, never replacing user entries.
- **FR-020**: The config-check poll MUST degrade gracefully when offline: preserve existing local config, log the failure, and retry on the next interval. No user-facing errors for transient network failures.

### Key Entities

- **DistributionManifest**: The typed contract between a skill repository and the settings reconciler. Declares managed skills (files to distribute), managed hooks (script + event binding + config), managed MCP servers (command + args + env + target scope), tenant config parameters, and schema version.
- **ManagedEntry**: A hook or MCP server entry owned by the distribution system. Identified by a `joyus:`-prefixed name, tracked in the sidecar registry with source bundle and manifest version.
- **ManagedRegistry**: The sidecar file (`.claude/.joyus-managed.json`) that maps managed entry identifiers to their source bundle, manifest version, and installation timestamp. Used for programmatic ownership tracking and consistency repair.
- **TenantConfig**: Per-tenant parameter values (thresholds, feature flags, plan tier settings) set by the control plane and written to a local config file for hook scripts to read.
- **ConfigCheckResult**: The outcome of a config-check poll — unchanged (no action), updated (trigger sync), revoked (trigger removal), or unreachable (preserve existing state).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a skill-sync cycle with a manifest containing hooks and MCP entries, 100% of declared managed entries appear in the correct settings file within one reconciliation pass.
- **SC-002**: After reconciliation, 100% of user-authored (non-`joyus:` prefixed) hooks and MCP entries remain byte-identical to their pre-reconciliation state.
- **SC-003**: When the control plane revokes a bundle, all associated managed entries are removed from the user's machine within the config-check poll interval (default 5 minutes) plus one sync cycle.
- **SC-004**: Reconciliation failure results in a complete rollback to the pre-reconciliation `settings.json` in 100% of failure scenarios — no partial writes persist.
- **SC-005**: Per-tenant configuration changes at the control plane are reflected in the user's local config files within the config-check poll interval plus one reconciliation pass.
- **SC-006**: The settings reconciler handles all edge cases (missing files, corrupted JSON, missing registry, concurrent access) without data loss or crash.
- **SC-007**: All managed entries are identifiable by both human inspection (`joyus:` prefix) and programmatic query (sidecar registry) with zero false positives or negatives.

### Assumptions

- Claude Code's `settings.json` format for hooks uses an array or object structure where entries can be appended without replacing existing entries. If hooks are keyed by event type with a single value (not an array), the reconciler will need to wrap entries in an array — this is determined during planning by inspecting the actual schema.
- The control plane's distribution config endpoint returns a `DistributionConfig` (as defined in `packages/skill-sync/src/distributionConfig.ts`) that can be extended with revocation flags and tenant config parameters without breaking the existing schema.
- Hook scripts are executable files (shell or Node) that read their configuration from a well-known file path. The reconciler writes the config file; the hook script reads it at runtime. There is no dynamic injection of values into the script itself.
- The `.claude/` directory exists on the user's machine (created by Claude Code on first run). The reconciler does not need to handle machines where Claude Code has never been installed.
- MCP server entries in `settings.json` and `.mcp.json` follow Claude Code's documented schema. Changes to that schema by Anthropic may require reconciler updates.
- The config-check poll interval (default 5 minutes) is acceptable for revocation timing. True real-time revocation (sub-second) is not required for the initial implementation.
