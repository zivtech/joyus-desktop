# Data Model: Desktop-to-Cloud Session Handoff

**Feature**: 002-desktop-cloud-session-handoff
**Date**: 2026-03-09

---

## Entities

### SessionSnapshot

The complete serialized state of a desktop session, transferred to the cloud during handoff.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| snapshot_id | string (UUID) | Yes | Unique identifier for this snapshot |
| session_id | string | Yes | Original desktop session identifier |
| tenant_id | string | Yes | Tenant that owns the session |
| workspace_id | string | Yes | Workspace context for the session |
| conversation_history | ConversationEntry[] | Yes | Ordered list of conversation messages |
| pending_actions | PendingAction[] | Yes | Actions queued but not yet executed (may be empty) |
| runtime_config | RuntimeConfig | Yes | Desktop runtime configuration at time of snapshot |
| policy_cache | PolicyCacheEntry[] | Yes | Cached policy decisions (may be empty) |
| artifacts | ArtifactReference[] | Yes | References to output artifacts (may be empty) |
| integrity_signature | string | Yes | HMAC or GCM auth tag covering the manifest |
| created_at | string (ISO 8601) | Yes | Timestamp of snapshot creation |
| schema_version | string | Yes | Snapshot format version (e.g., "1.0") |

**Uniqueness**: `snapshot_id` is globally unique. One snapshot per handoff attempt.

### ConversationEntry

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| entry_id | string | Yes | Unique message identifier |
| role | "user" \| "assistant" \| "system" | Yes | Message author role |
| content | string | Yes | Message content |
| timestamp | string (ISO 8601) | Yes | When the message was created |
| metadata | Record<string, unknown> | No | Additional message metadata |

### PendingAction

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| action_id | string | Yes | Unique action identifier |
| action_name | string | Yes | Name of the queued action |
| risk_level | "low" \| "medium" \| "high" | Yes | Risk classification |
| target | string | No | Action target resource |
| details | Record<string, unknown> | No | Action parameters |
| queued_at | string (ISO 8601) | Yes | When the action was queued |

### RuntimeConfig

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| execution_mode | "local" \| "remote" | Yes | Current execution target |
| tenant_class | "internal" \| "external" | Yes | Tenant classification |
| local_execution_enabled | boolean | Yes | Whether local execution is allowed |
| control_plane_url | string | Yes | Active control plane endpoint |

### PolicyCacheEntry

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| jti | string | Yes | Policy decision token ID |
| action_name | string | Yes | Action the decision applies to |
| decision | "allow" \| "deny" \| "escalate" | Yes | Cached policy outcome |
| risk_level | "low" \| "medium" \| "high" | Yes | Risk level at decision time |
| token_expires_at | string (ISO 8601) | Yes | When the decision token expires |

### ArtifactReference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| artifact_id | string | Yes | Unique artifact identifier |
| content_hash | string | Yes | SHA-256 hash of artifact content |
| size_bytes | number | Yes | Artifact size in bytes |
| content_type | string | Yes | MIME type of the artifact |
| label | string | No | Human-readable artifact name |

---

## Handoff Coordination Entities

### HandoffRequest

Sent by the desktop to initiate a handoff.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| handoff_id | string (UUID) | Yes | Unique handoff attempt identifier |
| session_id | string | Yes | Session being handed off |
| tenant_id | string | Yes | Owning tenant |
| workspace_id | string | Yes | Workspace context |
| policy_token | string | Yes | Authorization token from `verify_before_action` |
| manifest | SnapshotManifest | Yes | Metadata about the snapshot (sizes, artifact list) |
| initiated_at | string (ISO 8601) | Yes | Handoff initiation timestamp |

### HandoffReceipt

Returned by the cloud after successful handoff.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| handoff_id | string | Yes | Matches the request handoff_id |
| cloud_session_id | string | Yes | New session identifier on the cloud side |
| status | "completed" \| "failed" | Yes | Handoff outcome |
| pickup_url | string | No | URL where the user can access the cloud session |
| completed_at | string (ISO 8601) | Yes | When the handoff finished |
| error | string | No | Error description if status is "failed" |

### SnapshotManifest

Metadata-only summary of the snapshot, sent before the payload.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| snapshot_id | string | Yes | Matches the full snapshot |
| total_size_bytes | number | Yes | Total snapshot size (metadata + artifacts) |
| chunk_count | number | Yes | Number of encrypted chunks |
| chunk_size_bytes | number | Yes | Fixed chunk size (5 MiB default) |
| artifact_count | number | Yes | Number of artifact blobs |
| artifacts | ArtifactReference[] | Yes | Artifact metadata for upload slot allocation |
| schema_version | string | Yes | Snapshot format version |

---

## State Machine: Handoff Lifecycle

States: `initiated` → `authorizing` → `encrypting` → `transferring` → `completed` | `failed`

```
initiated ──► authorizing ──► encrypting ──► transferring ──► completed
    │              │              │               │
    └──► failed    └──► failed    └──► failed     └──► failed
```

**Transition rules** (to be refined during implementation):
- `initiated → authorizing`: Handoff request submitted, policy check begins
- `authorizing → encrypting`: Policy returns `allow`
- `authorizing → failed`: Policy returns `deny`, `escalate`, or is unavailable
- `encrypting → transferring`: Snapshot encrypted and chunked, manifest sent
- `encrypting → failed`: Encryption error or manifest rejected
- `transferring → completed`: All chunks and artifacts received and verified
- `transferring → failed`: Retries + resumable transfer exhausted, unrecoverable error

**Any state → failed**: Timeout, user cancellation, or unrecoverable error.
