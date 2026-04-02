---
work_package_id: WP08
title: Cloud Snapshot Verification & Session Reconstruction
lane: done
dependencies: [WP01, WP04]
subtasks:
- T037
- T038
- T039
- T040
phase: Phase 6 - Verification
assignee: ''
agent: ''
shell_pid: ''
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-03-10T15:13:40Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP08 – Cloud Snapshot Verification & Session Reconstruction

## Implementation Command

```bash
spec-kitty implement WP08 --base WP04
```

WP08 depends on WP01 (types) and WP04 (encryption — for decryption counterpart). Use WP04 as base.

**Note**: WP08 can start as soon as WP04 is done. It does not need to wait for WP05, WP06, or WP07.

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

- Define cloud-side verification contracts: decrypt, check integrity, validate manifest.
- Define session reconstruction contract: create cloud session from decrypted snapshot.
- Implement test doubles that simulate cloud behavior for desktop integration tests.
- All tampered/incomplete/malformed snapshots are rejected with specific errors.
- 100% line/function/branch/statement coverage.

## Context & Constraints

- **Spec requirements**: FR-008 (cloud contract for receiving snapshots), FR-009 (reject failed integrity), FR-010 (reconstruct fully functional session), US2 (cloud pickup), US4 (snapshot integrity).
- **This WP produces contracts and test doubles**, not the actual cloud implementation (that belongs to `joyus-ai`).
- **Encryption from WP04**: Decryption uses the same `decryptChunk` and `decryptArtifact` functions.
- **Data model**: `SessionSnapshot`, `SnapshotManifest`, `HandoffReceipt` from WP01 types.

## Subtasks & Detailed Guidance

### Subtask T037 – Define verification contract

- **Purpose**: Specify how the cloud verifies a received snapshot's integrity and completeness.
- **File**: `packages/policy-client/src/handoffVerification.ts`
- **Steps**:
  1. Define the verification interface:
     ```typescript
     export interface VerificationInput {
       encryptedChunks: EncryptedChunk[];
       encryptedArtifacts: EncryptedArtifact[];
       manifest: SnapshotManifest;
       cloudPrivateKey: CryptoKey;           // Cloud's X25519 private key
       desktopEphemeralPublicKey: Uint8Array; // Desktop's ephemeral public key
     }

     export interface VerificationResult {
       valid: boolean;
       snapshot?: SessionSnapshot;    // Present if valid
       errors: VerificationError[];   // Present if invalid
     }

     export interface VerificationError {
       code: 'DECRYPTION_FAILED' | 'INTEGRITY_MISMATCH' | 'MANIFEST_MISMATCH' | 'MISSING_ARTIFACT' | 'INVALID_SCHEMA';
       message: string;
       details?: Record<string, unknown>;
     }
     ```
  2. Implement `verifySnapshot(input: VerificationInput): Promise<VerificationResult>`:
     - **Step 1 — Key agreement**: Derive CEK from cloud private key + desktop ephemeral public key (reverse of WP04 key agreement).
     - **Step 2 — Decrypt chunks**: Decrypt each chunk using `decryptChunk` (WP04). On any GCM auth failure → return `DECRYPTION_FAILED` error.
     - **Step 3 — Reassemble**: Concatenate decrypted chunks into the full serialized snapshot.
     - **Step 4 — Deserialize**: Parse JSON into `SessionSnapshot`.
     - **Step 5 — Verify integrity**: Recompute HMAC-SHA256 (using WP02's algorithm) and compare with `integrity_signature`. Mismatch → return `INTEGRITY_MISMATCH`.
     - **Step 6 — Validate manifest**: Check chunk_count matches received chunks, artifact_count matches received artifacts, total_size matches. Mismatch → return `MANIFEST_MISMATCH`.
     - **Step 7 — Validate schema**: Check `schema_version`, required fields. Invalid → return `INVALID_SCHEMA`.
     - **Step 8 — Decrypt artifacts**: Decrypt each artifact using `decryptArtifact` (WP04). Verify content_hash matches. Missing artifact → return `MISSING_ARTIFACT`.
  3. Return `{ valid: true, snapshot }` if all checks pass, or `{ valid: false, errors }` if any fail.
- **Notes**: Collect ALL errors before returning (don't fail on first error) to give comprehensive feedback.

### Subtask T038 – Define session reconstruction contract

- **Purpose**: Specify how the cloud creates a functional session from a verified snapshot.
- **File**: `packages/policy-client/src/handoffVerification.ts`
- **Steps**:
  1. Define the reconstruction interface:
     ```typescript
     export interface ReconstructedSession {
       cloud_session_id: string;
       session_id: string;           // Original desktop session ID
       tenant_id: string;
       workspace_id: string;
       conversation_history: ConversationEntry[];
       pending_actions: PendingAction[];
       runtime_config: RuntimeConfig;
       policy_cache: PolicyCacheEntry[];
       artifacts: Map<string, Uint8Array>; // artifact_id → decrypted data
       reconstructed_at: string;
     }
     ```
  2. Implement `reconstructSession(snapshot: SessionSnapshot, decryptedArtifacts: Map<string, Uint8Array>): ReconstructedSession`:
     - Generate `cloud_session_id` using `crypto.randomUUID()`.
     - Copy all session state from snapshot.
     - Attach decrypted artifact data.
     - Set `reconstructed_at` to current timestamp.
  3. Validate completeness:
     - All `snapshot.artifacts` have corresponding entries in `decryptedArtifacts`.
     - Conversation history is non-empty.
     - Runtime config is present.
- **Notes**: This is a contract definition — the actual cloud session storage is in `joyus-ai`. This contract ensures the desktop-side tests validate the expected reconstruction behavior.

### Subtask T039 – Implement test doubles for cloud behavior

- **Purpose**: Provide realistic cloud simulation for desktop integration tests.
- **File**: `packages/policy-client/src/handoffVerification.ts` (exports), `packages/policy-client/src/handoffVerification.test.ts` (usage)
- **Steps**:
  1. Implement `createMockCloudVerifier()`:
     ```typescript
     export function createMockCloudVerifier(): {
       keyPair: Promise<{ publicKey: Uint8Array; privateKey: CryptoKey }>;
       verify: (input: VerificationInput) => Promise<VerificationResult>;
       reconstruct: (snapshot: SessionSnapshot, artifacts: Map<string, Uint8Array>) => ReconstructedSession;
     }
     ```
  2. The mock verifier:
     - Generates a cloud X25519 key pair on creation.
     - Exposes the public key (so desktop can use it for encryption).
     - `verify` runs the full verification pipeline.
     - `reconstruct` runs the reconstruction.
  3. This mock is the "cloud-side test double" that WP07 integration tests can use to verify end-to-end correctness.
- **Notes**: The mock verifier should be deterministic when given the same inputs. Export it for downstream WP use.

### Subtask T040 – Write tests for verification and reconstruction

- **Purpose**: Achieve 100% coverage for verification and reconstruction contracts.
- **File**: `packages/policy-client/src/handoffVerification.test.ts`
- **Steps**:
  1. **Setup**: Use WP04's encryption functions to create test encrypted snapshots. Use WP02's assembly functions to create test snapshots.
  2. **Verification happy path**:
     - Create snapshot → encrypt → verify with correct cloud key → `valid: true`, snapshot matches original.
  3. **Tampered chunk**:
     - Encrypt snapshot → modify one byte of ciphertext → verify → `valid: false`, `DECRYPTION_FAILED` error.
  4. **Integrity mismatch**:
     - Encrypt snapshot → modify the integrity_signature before encryption → verify → `valid: false`, `INTEGRITY_MISMATCH`.
  5. **Manifest mismatch**:
     - Encrypt snapshot → pass wrong chunk count in manifest → verify → `valid: false`, `MANIFEST_MISMATCH`.
  6. **Missing artifact**:
     - Snapshot references 2 artifacts → only provide 1 encrypted artifact → verify → `valid: false`, `MISSING_ARTIFACT`.
  7. **Invalid schema**:
     - Snapshot with unknown `schema_version` → verify → `valid: false`, `INVALID_SCHEMA`.
  8. **Reconstruction tests**:
     - Valid snapshot → reconstruct → all fields present, cloud_session_id generated, timestamps set.
     - Conversation history preserved in order.
     - Pending actions preserved.
     - All artifacts available in map.
  9. **Mock cloud verifier**:
     - Create mock → get public key → encrypt with public key → mock.verify succeeds.
     - Create mock → encrypt with wrong key → mock.verify fails.
  10. **Error accumulation**:
      - Multiple errors (tampered + missing artifact) → both reported.
  11. Run `pnpm coverage` — 100% required.

## Test Strategy

- **Framework**: Vitest
- **Coverage**: 100% enforced
- **Integration-style tests**: These tests exercise WP01, WP02, and WP04 code paths to verify the full encrypt→verify→reconstruct pipeline.
- **Fixtures**: Reuse `createTestSnapshotInput()` from WP02 tests.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Key agreement direction (desktop→cloud vs cloud→desktop) | Test bidirectional: desktop encrypts, cloud decrypts |
| Error accumulation complexity | Test with multiple simultaneous errors |
| Contract drift from actual cloud implementation | Keep contracts aligned with handoff-api.yaml |

## Review Guidance

- Verify verification collects ALL errors, not just the first one.
- Verify key agreement direction is correct (cloud private key + desktop ephemeral public key).
- Verify reconstruction produces complete session state with all fields.
- Verify mock cloud verifier is reusable by downstream WPs (exported, documented).
- Verify integrity check uses the same algorithm as WP02's `computeIntegritySignature`.
- Confirm 100% coverage.

## Activity Log

- 2026-03-10T15:13:40Z – system – lane=planned – Prompt created.
