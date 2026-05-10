# Data Model: Recon Operator

**Mission**: `recon-operator-01KRA2P1`
**Date**: 2026-05-10

## Entities

### Engagement

Represents a single Recon analysis run against a client site.

| Field | Type | Description |
|-------|------|-------------|
| engagementId | string | Unique identifier (UUID or slug-timestamp) |
| clientName | string | Human-readable client name |
| clientSlug | string | URL-safe slugified client name |
| url | string | Target website URL |
| accessMode | enum: rfp, discovery, full | Scope of analysis |
| status | enum: created, running, complete, error, cancelled | Current lifecycle state |
| engagementDir | string (path) | Absolute path to engagement workspace |
| pid | number | OS process ID of the analysis tool (while running) |
| launchTime | ISO-8601 | When the analysis was launched |
| completedAt | ISO-8601 | When the analysis finished (null while running) |
| exitCode | number | Process exit code (null while running) |
| phasesCompleted | number | Number of analysis phases completed (from sentinel) |
| outputFiles | string[] | List of output file paths (from sentinel) |
| skillVersion | string | Version of the analysis skill used |
| error | string | Error description (if status is error) |

**State transitions**:
```
created → running → complete
                  → error
                  → cancelled
```

**Storage**: Engagement metadata persisted as JSON in the engagement directory (`.recon-meta.json`). List of engagements reconstructed by scanning `~/Documents/joyus-recon-engagements/*/`.

### Credential

Represents a stored API credential.

| Field | Type | Description |
|-------|------|-------------|
| key | string | Credential identifier (from allowlist) |
| isSet | boolean | Whether a value is stored |
| valid | boolean | Whether the last validation check passed |
| lastVerified | ISO-8601 | When the credential was last validated |

**Allowlist**: DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD, CRUX_API_KEY, ANTHROPIC_API_KEY, PAGESPEED_API_KEY

**Storage**:
- Phase 1: `~/Library/Application Support/com.joyus.desktop-companion/credentials.env` (KEY=value format, 0600 permissions)
- Phase 2: macOS Keychain (service: `com.joyus.desktop-companion`, key per credential)

**Note**: Credential values are NEVER returned to the frontend. Only `key`, `isSet`, and `valid` are exposed via IPC.

### CompletionSentinel

Machine-readable file written by the analysis skill at engagement completion.

| Field | Type | Description |
|-------|------|-------------|
| status | enum: success, error | Outcome of the analysis |
| timestamp | ISO-8601 | When the analysis completed |
| phases_completed | number | Number of phases that ran |
| output_files | string[] | Files produced (success only) |
| error | string | Error description (error only) |
| last_phase_completed | number | Last phase that completed before error (error only) |
| skill_version | string | Version of the skill that ran (Phase 2+) |

**Storage**: `{engagementDir}/.recon-complete` (JSON file)

### ScanResult

Output of the sensitive-content scan.

| Field | Type | Description |
|-------|------|-------------|
| passed | boolean | Whether the scan found no issues |
| findings | Finding[] | List of flagged items |

### Finding

A single flagged item from the sensitive-content scan.

| Field | Type | Description |
|-------|------|-------------|
| file | string | Relative file path within engagement directory |
| line | number | Line number of the match |
| pattern | string | Name of the pattern that matched |

### ScanOverride

Audit log entry for when an operator overrides a scan finding.

| Field | Type | Description |
|-------|------|-------------|
| timestamp | ISO-8601 | When the override was performed |
| operator | string | Who performed the override (for audit) |
| finding | Finding | The finding that was overridden |
| reason | string | Operator-provided justification |

**Storage**: `{engagementDir}/.scan-overrides.json` (array of ScanOverride)

### ReadinessItem

A single entry in the pre-engagement readiness matrix.

| Field | Type | Description |
|-------|------|-------------|
| name | string | What is being checked (e.g., "Claude Code", "Credentials") |
| status | enum: ready, warning, error, unchecked | Current state |
| detail | string | Human-readable status description |
| critical | boolean | Whether this item blocks engagement launch |

## Relationships

```
Engagement 1──* OutputFile (file list in sentinel)
Engagement 1──1 CompletionSentinel (optional — process exit is primary signal)
Engagement 1──1 ScanResult (per export attempt)
ScanResult 1──* Finding
ScanResult 1──* ScanOverride (if operator overrides)
ReadinessItem *──1 Preflight check (run on demand)
```

## Engagement Directory Structure

```
~/Documents/joyus-recon-engagements/{client-slug}/
├── .recon-meta.json          # Engagement metadata (Desktop-managed)
├── .recon-complete            # Completion sentinel (analysis-tool-managed)
├── .scan-overrides.json       # Scan override audit log (Desktop-managed)
├── [output files]             # Analysis results (ARDs, competitive analysis, etc.)
└── [template files]           # Copied at engagement creation
```

**Export exclusions**: `.recon-meta.json`, `.recon-complete`, `.scan-overrides.json`, `.env`, `node_modules/`, `.git/`, `credentials*`
