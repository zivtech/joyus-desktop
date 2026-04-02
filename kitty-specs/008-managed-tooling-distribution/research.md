# Research: Managed Tooling Distribution

**Feature**: 008-managed-tooling-distribution
**Date**: 2026-04-01

## R1: Claude Code Settings.json Hook Schema

**Decision**: Hooks are array-based per event type. Managed hooks are appended as additional matcher group entries.

**Rationale**: Examined OMC plugin hooks.json and security-guidance plugin hooks.json. The format is:
```
hooks.<EventType> = [{ matcher: string, hooks: [{ type: "command", command: string, timeout?: number }] }]
```
Event types include: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`, `PreCompact`, `Stop`, `SubagentStart`, `SubagentStop`, `PermissionRequest`, `PostToolUseFailure`.

Matchers are glob patterns (e.g., `"*"`, `"Bash"`, `"Edit|Write|MultiEdit"`). Using `"joyus:<name>"` as the matcher pattern uniquely identifies managed hooks and won't collide with tool-name matchers used by user/plugin hooks.

**Alternatives considered**: Single-value-per-event (rejected — format is arrays). Embedding managed hooks inside existing matcher groups (rejected — complicates merge and identification).

## R2: Atomic File Writes on macOS and Windows

**Decision**: Use write-to-temp-then-rename pattern for atomic settings.json updates.

**Rationale**: `fs.rename()` is atomic on POSIX filesystems (macOS HFS+/APFS, Linux ext4). On Windows NTFS, `fs.rename()` is atomic when source and destination are on the same volume (which they will be — both in `~/.claude/`). This is the standard pattern used by editors, package managers, and databases for crash-safe writes.

**Implementation**: Write to `settings.json.tmp` in the same directory, then `fs.rename('settings.json.tmp', 'settings.json')`. If the process crashes after write but before rename, the temp file is cleaned up on next reconciliation.

**Alternatives considered**: In-place write with fsync (not atomic — partial write on crash). File locking with advisory locks (unnecessary complexity — rename is sufficient for single-writer).

## R3: Non-Destructive Merge Strategy

**Decision**: Shallow key-based merge for MCP servers, array append for hooks. Never modify non-`joyus:` entries.

**Rationale**: The two settings shapes are:
1. **Hooks** (`hooks.<Event>[]`): Array of matcher groups. Append managed entries; filter out stale managed entries by `joyus:` prefix in matcher.
2. **MCP Servers** (`mcpServers.<name>`): Object keyed by server name. Add/update/remove keys with `joyus:` prefix; leave all other keys untouched.

No deep merge is needed. The reconciler reads the full file, modifies only managed entries, and writes back.

**Alternatives considered**: JSON Patch (RFC 6902) — overkill for this shape. Deep merge libraries (lodash.merge) — unnecessary dependency, and deep merge could accidentally modify nested user config.

## R4: Manifest Delivery via Control Plane

**Decision**: Manifest is an extension of the existing `DistributionConfig` response, served per-tenant from the control plane.

**Rationale**: `DistributionConfig` already supports per-bundle version pins and can be loaded from a URL (`loadDistributionConfigFromUrl`). The manifest extends this with `hooks`, `mcpServers`, and `config` fields per bundle. The config-check poll hits the same endpoint — one fetch gets both version info and manifest content.

This avoids:
- Embedding tenant-specific config in git repos (branching nightmare)
- Separate API contracts for version checking vs manifest delivery
- Extra network calls (version check + separate manifest fetch)

**Alternatives considered**: Manifest in skill repo (rejected — tenant-specific values don't belong in a shared repo). Separate manifest endpoint (rejected — one fetch is better than two).

## R5: Config-Check Poll Design

**Decision**: Lightweight ETag/version-based poll on 5-minute default interval, triggering full sync only on change.

**Rationale**: The poll checks a single JSON endpoint. If the response includes the same version hash as the last successful reconciliation, no action is taken. If the version differs (or a `revoked: true` flag is present), trigger the full sync+reconcile pipeline.

The 5-minute interval balances responsiveness (revocation within 5 minutes) against API load (288 requests/day/user). The interval is configurable per-tenant via the `DistributionConfig`.

**Implementation**: Desktop-companion sidecar module using `setInterval`. Stores last-seen version hash in the sidecar registry. On mismatch: calls `syncSkills()` then `reconcile()`. On network failure: logs warning, keeps existing state, retries next interval.

**Alternatives considered**: WebSocket push (rejected — new infrastructure for marginal latency improvement). 1-minute poll (rejected — 1440 req/day/user is excessive for the revocation SLA).

## R6: Sidecar Registry Recovery

**Decision**: Registry is rebuildable from `joyus:` prefix scanning. It's a cache, not the source of truth.

**Rationale**: If `.claude/.joyus-managed.json` is deleted or corrupted, the reconciler can scan the current `settings.json` for `joyus:`-prefixed entries (hook matchers and MCP server keys) and rebuild the registry. This makes the system self-healing.

The registry adds value by storing metadata (bundle name, manifest version, installation timestamp) that can't be derived from settings.json alone. But for the core question "which entries are managed?" the prefix is sufficient.

**Alternatives considered**: Registry as sole source of truth (rejected — creates a single point of failure where registry corruption means all managed entries become invisible). Checksum-based verification (rejected — adds complexity without meaningful benefit over prefix scanning).
