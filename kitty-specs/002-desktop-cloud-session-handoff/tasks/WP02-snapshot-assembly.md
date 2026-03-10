---
work_package_id: WP02
title: Snapshot Assembly
lane: "doing"
dependencies: [WP01]
base_branch: 002-desktop-cloud-session-handoff-WP01
base_commit: a9a6bf7926cf3f8037515271481ea2cf3184a8fb
created_at: '2026-03-10T16:00:15.863063+00:00'
subtasks:
- T005
- T006
- T007
- T008
- T009
phase: Phase 2 - Core Capabilities
assignee: ''
agent: ''
shell_pid: "84427"
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-03-10T15:13:40Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP02 – Snapshot Assembly

## Implementation Command

```bash
spec-kitty implement WP02 --base WP01
```

## Review Feedback Status

**Read this first if you are implementing this task!**

- **Has review feedback?**: Check the `review_status` field above. If it says `has_feedback`, scroll to the **Review Feedback** section immediately.
- **You must address all feedback** before your work is complete.

---

## Review Feedback

> **Populated by `/spec-kitty.review`**

*[This section is empty initially.]*

---

## Objectives & Success Criteria

- Implement a snapshot builder that collects all session state components into a `SessionSnapshot`.
- Validate snapshots against schema requirements (required fields, version).
- Generate a `SnapshotManifest` with accurate chunk counts and sizes.
- Compute an integrity signature (HMAC-SHA256) covering the serialized snapshot.
- 100% line/function/branch/statement coverage.

## Context & Constraints

- **Types from WP01**: Import `SessionSnapshot`, `SnapshotManifest`, `ArtifactReference`, `ConversationEntry`, `PendingAction`, `RuntimeConfig`, `PolicyCacheEntry`, `DEFAULT_CHUNK_SIZE`, `SCHEMA_VERSION` from `packages/policy-client/src/handoffTypes.ts`.
- **Spec requirements**: FR-006 (snapshot must include session identity, conversation history, pending actions, runtime config, policy cache, artifacts).
- **FR-007a**: Snapshot must include integrity signature verifiable by cloud.
- **Chunk sizing**: 5 MiB default (from research.md R4), 256 KiB alignment.

## Subtasks & Detailed Guidance

### Subtask T005 – Implement snapshot builder

- **Purpose**: Collect all desktop runtime state into a single `SessionSnapshot` object.
- **File**: `apps/desktop-companion/src/snapshotAssembly.ts`
- **Steps**:
  1. Define input interface for the builder:
     ```typescript
     export interface SnapshotInput {
       session_id: string;
       tenant_id: string;
       workspace_id: string;
       conversation_history: ConversationEntry[];
       pending_actions: PendingAction[];
       runtime_config: RuntimeConfig;
       policy_cache: PolicyCacheEntry[];
       artifacts: ArtifactReference[];
     }
     ```
  2. Implement `assembleSnapshot(input: SnapshotInput): SessionSnapshot`:
     - Generate `snapshot_id` using `crypto.randomUUID()`.
     - Set `created_at` to current ISO 8601 timestamp.
     - Set `schema_version` to `SCHEMA_VERSION` constant.
     - Set `integrity_signature` to empty string initially (computed in T008).
     - Copy all input fields into the snapshot.
  3. Return the assembled `SessionSnapshot`.
- **Notes**: The builder is intentionally simple — it's a structured collector. Validation (T006) and signature (T008) are separate concerns.

### Subtask T006 – Implement snapshot validation

- **Purpose**: Ensure a snapshot meets schema requirements before encryption.
- **File**: `apps/desktop-companion/src/snapshotAssembly.ts`
- **Steps**:
  1. Implement `validateSnapshot(snapshot: SessionSnapshot): void`:
     - Check all required string fields are non-empty: `snapshot_id`, `session_id`, `tenant_id`, `workspace_id`, `schema_version`, `created_at`.
     - Check `schema_version` matches `SCHEMA_VERSION` (or is a recognized version).
     - Check `conversation_history` is a non-empty array (a session with no history is invalid for handoff).
     - Check `runtime_config` has all required fields populated.
     - Throw `HandoffError` with code `'INVALID_SNAPSHOT'` on any failure, including which field failed.
  2. Call `validateSnapshot` at the end of `assembleSnapshot` before returning.
- **Edge cases**:
  - `pending_actions` and `policy_cache` may be empty arrays (valid).
  - `artifacts` may be empty (valid — not all sessions produce artifacts).
  - `conversation_history` must have at least one entry.

### Subtask T007 – Implement manifest generation

- **Purpose**: Create a `SnapshotManifest` describing the snapshot's structure for the upload protocol.
- **File**: `apps/desktop-companion/src/snapshotAssembly.ts`
- **Steps**:
  1. Implement `generateManifest(snapshot: SessionSnapshot, chunkSize?: number): SnapshotManifest`:
     - Serialize the snapshot to JSON to determine `total_size_bytes` (use `Buffer.byteLength(JSON.stringify(snapshot), 'utf-8')`).
     - Calculate `chunk_count = Math.ceil(total_size_bytes / effectiveChunkSize)`.
     - `effectiveChunkSize`: If provided `chunkSize` is not 256 KiB aligned, round up to next 256 KiB boundary.
     - Default `chunkSize` is `DEFAULT_CHUNK_SIZE` (5 MiB).
     - Set `artifact_count` from `snapshot.artifacts.length`.
     - Copy `snapshot.artifacts` into manifest's `artifacts` array.
     - Set `schema_version` from snapshot.
  2. Return the `SnapshotManifest`.
- **Edge cases**:
  - Snapshot smaller than one chunk → `chunk_count = 1`.
  - No artifacts → `artifact_count = 0`, empty artifacts array.
  - Custom chunk size not 256 KiB aligned → round up.

### Subtask T008 – Implement integrity signature computation

- **Purpose**: Produce an HMAC-SHA256 signature covering the snapshot for integrity verification.
- **File**: `apps/desktop-companion/src/snapshotAssembly.ts`
- **Steps**:
  1. Implement `computeIntegritySignature(snapshot: SessionSnapshot, signingKey: Buffer): string`:
     - Serialize the snapshot without the `integrity_signature` field (set it to empty string before hashing).
     - Compute HMAC-SHA256 over the serialized JSON using the provided signing key.
     - Return the hex-encoded HMAC.
  2. Implement `assembleAndSignSnapshot(input: SnapshotInput, signingKey: Buffer): SessionSnapshot`:
     - Call `assembleSnapshot` to build the snapshot.
     - Call `computeIntegritySignature` to compute the signature.
     - Return the snapshot with `integrity_signature` set.
- **Notes**: The signing key will be derived from the ECDH shared secret in WP04. For now, accept it as a parameter. In tests, use a fixed test key.

### Subtask T009 – Write tests for snapshot assembly

- **Purpose**: Achieve 100% coverage for all snapshot assembly functions.
- **File**: `apps/desktop-companion/src/snapshotAssembly.test.ts`
- **Steps**:
  1. Create test factory: `createTestSnapshotInput()` returning a valid `SnapshotInput` with realistic data.
  2. **assembleSnapshot tests**:
     - Valid input → returns snapshot with all fields populated.
     - Generated `snapshot_id` is a valid UUID.
     - `created_at` is a valid ISO 8601 timestamp.
     - `schema_version` matches `SCHEMA_VERSION`.
  3. **validateSnapshot tests**:
     - Valid snapshot passes.
     - Missing `session_id` → throws with `INVALID_SNAPSHOT`.
     - Missing `tenant_id` → throws.
     - Empty `conversation_history` → throws.
     - Empty `pending_actions` → passes (valid).
     - Empty `artifacts` → passes (valid).
     - Invalid `schema_version` → throws.
  4. **generateManifest tests**:
     - Small snapshot (< 5 MiB) → `chunk_count = 1`.
     - Large snapshot (> 5 MiB) → correct chunk count.
     - Custom chunk size → correct calculation.
     - Non-aligned chunk size → rounded up to 256 KiB boundary.
     - No artifacts → `artifact_count = 0`.
  5. **computeIntegritySignature tests**:
     - Deterministic: same input + key → same signature.
     - Different key → different signature.
     - Signature is hex-encoded.
  6. **assembleAndSignSnapshot tests**:
     - Returns snapshot with non-empty `integrity_signature`.
     - Signature verifiable with same key.

## Test Strategy

- **Framework**: Vitest
- **Coverage**: 100% enforced by `pnpm coverage`
- **Fixtures**: Create reusable `createTestSnapshotInput()` factory — will be needed by downstream WPs (WP04, WP07).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| JSON serialization size inaccuracy | Use `Buffer.byteLength` not `string.length` |
| Chunk alignment off-by-one | Test with exact boundary sizes (e.g., exactly 5 MiB, 5 MiB + 1 byte) |
| HMAC key management | Accept key as parameter; WP04 handles derivation |

## Review Guidance

- Verify all FR-006 fields are collected in the snapshot builder.
- Verify chunk calculation handles edge cases (< 1 chunk, exact boundary, non-aligned sizes).
- Verify integrity signature excludes the signature field itself from the hash input.
- Confirm 100% coverage.

## Activity Log

- 2026-03-10T15:13:40Z – system – lane=planned – Prompt created.
