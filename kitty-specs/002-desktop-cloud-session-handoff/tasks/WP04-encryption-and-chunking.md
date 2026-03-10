---
work_package_id: WP04
title: E2E Encryption & Chunking
lane: "done"
dependencies: [WP01, WP02]
base_branch: 002-desktop-cloud-session-handoff-WP02
base_commit: 72aba0ed3872f245eb9a250209241e4d5b8e3726
created_at: '2026-03-10T16:04:21.610208+00:00'
subtasks:
- T014
- T015
- T016
- T017
- T018
- T019
phase: Phase 3 - Encryption
assignee: ''
agent: ''
shell_pid: "1046"
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-03-10T15:13:40Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks
---

# Work Package Prompt: WP04 – E2E Encryption & Chunking

## Implementation Command

```bash
spec-kitty implement WP04 --base WP02
```

WP04 depends on WP01 and WP02. Use WP02 as base (which already includes WP01).

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

- Implement hybrid ECIES encryption: X25519 key exchange + HKDF-SHA256 key derivation + AES-256-GCM per-chunk encryption.
- Per-chunk integrity with sequence-number AAD binding to prevent reordering attacks.
- Fixed chunk boundary splitting (5 MiB default, 256 KiB aligned) for tus protocol compatibility.
- Per-artifact encryption with independent IVs.
- Tampered and reordered chunks are rejected during decryption.
- 100% line/function/branch/statement coverage.

## Context & Constraints

- **Research decisions**: R1 (Hybrid ECIES), R2 (chunk-then-encrypt with per-chunk GCM + AAD) from `research/research.md`.
- **Spec requirements**: FR-007 (E2E encryption), FR-007a (integrity signature), SC-002a (no plaintext on wire).
- **Node.js requirement**: X25519 via Web Crypto API requires Node.js >=22.13 or >=20.19.
- **Data model**: Chunk structure from `research/data-model.md` § SnapshotManifest.
- **Constitution 2.3**: Security-first — encryption is non-negotiable.

## Subtasks & Detailed Guidance

### Subtask T014 – Implement ECDH key agreement and CEK derivation

- **Purpose**: Establish a shared secret between desktop and cloud using X25519, then derive an AES-256 content encryption key.
- **File**: `packages/policy-client/src/snapshotEncryption.ts`
- **Steps**:
  1. Import `crypto` (Node.js built-in webcrypto or `node:crypto`).
  2. Implement `generateEphemeralKeyPair(): Promise<{ publicKey: Uint8Array; privateKey: CryptoKey }>`:
     - Generate X25519 key pair using Web Crypto API.
     - Export public key as raw bytes (32 bytes).
     - Keep private key as `CryptoKey` (non-extractable).
  3. Implement `deriveContentEncryptionKey(privateKey: CryptoKey, peerPublicKey: Uint8Array): Promise<CryptoKey>`:
     - Import peer's public key as X25519 `CryptoKey`.
     - Perform ECDH to get shared secret.
     - Derive AES-256 key via HKDF-SHA256:
       - Salt: empty (or a fixed domain separator like `"joyus-handoff-v1"`).
       - Info: `"handoff-cek"` (context string).
       - Key length: 256 bits.
     - Return the derived `CryptoKey` (for AES-256-GCM).
  4. Export a convenience `KeyAgreementResult`:
     ```typescript
     export interface KeyAgreementResult {
       ephemeralPublicKey: Uint8Array;  // 32 bytes, sent to cloud
       contentEncryptionKey: CryptoKey; // AES-256-GCM key
     }
     ```
  5. Implement `performKeyAgreement(cloudPublicKey: Uint8Array): Promise<KeyAgreementResult>` that wraps steps above.
- **Notes**: Use `"X25519"` algorithm name. Private key should be non-extractable for security.

### Subtask T015 – Implement per-chunk AES-256-GCM encryption

- **Purpose**: Encrypt each chunk with AES-256-GCM using the derived CEK and a unique IV.
- **File**: `packages/policy-client/src/snapshotEncryption.ts`
- **Steps**:
  1. Define `EncryptedChunk`:
     ```typescript
     export interface EncryptedChunk {
       chunkIndex: number;
       iv: Uint8Array;         // 12 bytes, random
       ciphertext: Uint8Array; // Encrypted data + GCM auth tag
       aad: Uint8Array;        // Additional authenticated data
     }
     ```
  2. Implement `encryptChunk(cek: CryptoKey, plaintext: Uint8Array, chunkIndex: number, totalChunks: number, sessionId: string): Promise<EncryptedChunk>`:
     - Generate 12-byte random IV using `crypto.getRandomValues`.
     - Construct AAD (see T016).
     - Encrypt with `crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, cek, plaintext)`.
     - Return `EncryptedChunk` with all fields.
  3. Implement `decryptChunk(cek: CryptoKey, chunk: EncryptedChunk): Promise<Uint8Array>`:
     - Decrypt with `crypto.subtle.decrypt({ name: 'AES-GCM', iv: chunk.iv, additionalData: chunk.aad, tagLength: 128 }, cek, chunk.ciphertext)`.
     - Return decrypted plaintext.
     - On GCM auth failure → throws (Web Crypto throws `OperationError`).
- **Notes**: GCM auth tag is appended to ciphertext by Web Crypto API (no need to split).

### Subtask T016 – Implement sequence-number AAD binding

- **Purpose**: Prevent chunk reordering attacks by binding each chunk to its position.
- **File**: `packages/policy-client/src/snapshotEncryption.ts`
- **Steps**:
  1. Implement `buildChunkAAD(sessionId: string, chunkIndex: number, totalChunks: number): Uint8Array`:
     - Construct string: `"${sessionId}:${chunkIndex}:${totalChunks}"`.
     - Encode as UTF-8 bytes.
  2. Use this AAD in both `encryptChunk` and `decryptChunk`.
- **Security**: If a chunk is presented at the wrong index, the AAD won't match and GCM decryption will fail. This prevents:
  - Chunk reordering (swapping chunk 0 and chunk 1).
  - Chunk duplication (presenting chunk 0 twice).
  - Chunk from different session (different sessionId).

### Subtask T017 – Implement fixed chunk boundary splitting

- **Purpose**: Split serialized snapshot data into fixed-size chunks for the tus upload protocol.
- **File**: `packages/policy-client/src/snapshotEncryption.ts`
- **Steps**:
  1. Implement `splitIntoChunks(data: Uint8Array, chunkSize: number = DEFAULT_CHUNK_SIZE): Uint8Array[]`:
     - Split `data` into chunks of `chunkSize` bytes.
     - Last chunk may be smaller than `chunkSize`.
     - If data is empty, return empty array.
  2. Implement `alignChunkSize(requestedSize: number): number`:
     - Round up to next 256 KiB (262,144 byte) boundary.
     - Minimum chunk size: 256 KiB.
  3. Implement top-level `encryptSnapshot(cek: CryptoKey, snapshotData: Uint8Array, sessionId: string, chunkSize?: number): Promise<EncryptedChunk[]>`:
     - Align chunk size.
     - Split data into chunks.
     - Encrypt each chunk with sequential index.
     - Return array of `EncryptedChunk`.
- **Edge cases**:
  - Data smaller than one chunk → single chunk.
  - Data exactly equal to chunk size → single chunk (no empty trailing chunk).
  - Empty data → empty array.

### Subtask T018 – Implement per-artifact encryption

- **Purpose**: Encrypt each artifact blob independently using the same CEK but unique IVs.
- **File**: `packages/policy-client/src/snapshotEncryption.ts`
- **Parallel**: Yes — can be implemented alongside T015-T016.
- **Steps**:
  1. Define `EncryptedArtifact`:
     ```typescript
     export interface EncryptedArtifact {
       artifact_id: string;
       iv: Uint8Array;
       ciphertext: Uint8Array;
     }
     ```
  2. Implement `encryptArtifact(cek: CryptoKey, artifactId: string, data: Uint8Array): Promise<EncryptedArtifact>`:
     - Generate 12-byte random IV.
     - AAD: `artifact_id` encoded as UTF-8.
     - Encrypt with AES-256-GCM.
  3. Implement `decryptArtifact(cek: CryptoKey, encrypted: EncryptedArtifact): Promise<Uint8Array>`:
     - Decrypt using artifact_id as AAD.
     - Throws on tampering.
- **Notes**: Artifacts are uploaded separately from the main snapshot chunks, so they need independent encryption.

### Subtask T019 – Write encryption tests

- **Purpose**: Achieve 100% coverage with security-focused test cases.
- **File**: `packages/policy-client/src/snapshotEncryption.test.ts`
- **Steps**:
  1. **Key agreement tests**:
     - Generate two key pairs, perform agreement → both sides derive same CEK (test by encrypting with one, decrypting with the derived key from the other side).
     - Public key is 32 bytes.
     - `performKeyAgreement` returns valid result.
  2. **Chunk encryption round-trip**:
     - Encrypt then decrypt → plaintext matches original.
     - Different chunks get different IVs.
  3. **Tampered chunk rejection**:
     - Modify one byte of ciphertext → decryption throws.
     - Modify IV → decryption throws.
  4. **Reordered chunk rejection**:
     - Encrypt chunk 0 and chunk 1 → swap their indices in AAD → decryption of swapped chunk throws.
  5. **Chunk splitting tests**:
     - Data smaller than chunk size → 1 chunk.
     - Data exactly chunk size → 1 chunk.
     - Data slightly over chunk size → 2 chunks, second is smaller.
     - Large data → correct number of chunks.
     - Empty data → 0 chunks.
     - Chunk alignment: non-aligned size rounds up.
  6. **Artifact encryption tests**:
     - Round-trip: encrypt then decrypt → matches.
     - Tampered ciphertext → throws.
     - Wrong artifact_id as AAD → throws.
  7. **Full encryptSnapshot flow**:
     - Serialize test snapshot → encrypt → decrypt all chunks → reassemble → matches original.
  8. **Deterministic test vectors**: Use fixed key pairs for reproducible tests where needed (import raw key bytes).

## Test Strategy

- **Framework**: Vitest
- **Coverage**: 100% enforced
- **Security tests are critical**: Every tamper/reorder test is a security invariant.
- **Test vectors**: Create `testVectors.ts` with fixed keys for reproducible tests.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| X25519 unavailable on CI Node.js | Pin Node.js >=22.13 in CI; add runtime version check |
| GCM nonce reuse | Use `crypto.getRandomValues` for every IV; test uniqueness |
| Key derivation mismatch | Test round-trip between two independent key agreements |
| Chunk boundary off-by-one | Test exact boundary sizes |

## Review Guidance

- Verify X25519 + HKDF-SHA256 + AES-256-GCM chain matches research.md R1 specification.
- Verify AAD format matches `"${sessionId}:${chunkIndex}:${totalChunks}"` exactly.
- Verify tamper and reorder tests actually test the security properties (not just "throws something").
- Verify IV is 12 bytes and random (not derived or sequential).
- Verify private keys are non-extractable.
- Confirm 100% coverage.

## Activity Log

- 2026-03-10T15:13:40Z – system – lane=planned – Prompt created.
