# Research: Desktop-to-Cloud Session Handoff

**Feature**: 002-desktop-cloud-session-handoff
**Date**: 2026-03-09

---

## R1: E2E Encryption Scheme

### Decision: Hybrid ECIES (X25519 + HKDF-SHA256 + AES-256-GCM)

**Rationale**: Cloud holds an asymmetric key pair. Desktop generates an ephemeral symmetric Content Encryption Key (CEK) per snapshot via ECDH key agreement. Each snapshot gets a unique CEK, providing forward secrecy — compromising one key exposes only one snapshot.

**Key Exchange Flow**:
1. Desktop calls `POST /session-handoff/initiate` on the cloud endpoint.
2. Cloud responds with a session-scoped X25519 public key (generated fresh per handoff).
3. Desktop generates ephemeral X25519 key pair, performs ECDH to derive shared secret.
4. CEK derived via `HKDF-SHA256(sharedSecret, salt=sessionId, info="joyus-snapshot-v1", length=32)`.
5. Desktop encrypts snapshot chunks with CEK (AES-256-GCM), sends ephemeral public key alongside ciphertext.
6. Cloud reconstructs shared secret using its private key + desktop's ephemeral public key, re-derives CEK, decrypts.

**Algorithm Stack**:

| Layer | Algorithm | Notes |
|-------|-----------|-------|
| Key exchange | X25519 (ECDH) | Stable in Node.js Web Crypto API since v22.13/v20.19 |
| KDF | HKDF-SHA-256 | RFC 5869. Salted with session nonce. |
| Symmetric cipher | AES-256-GCM | AEAD, 96-bit IV, 128-bit auth tag. AES-NI accelerated on server. |

**Alternatives Considered**:
- *Pure symmetric PSK*: No forward secrecy, key distribution burden. Rejected.
- *RSA-OAEP wrapping*: Slower key generation, larger wire format (256B vs 32B public key). Rejected.
- *TLS-only*: Protects transport but not at-rest on cloud side. Insufficient for E2E requirement.
- *ChaCha20-Poly1305*: Preferable on mobile/embedded without AES-NI. Desktop + cloud both have AES-NI, so AES-256-GCM is faster (~6.4 GB/s vs ~4.2 GB/s).

---

## R2: Encryption + Chunked Upload Interaction

### Decision: Chunk-then-encrypt with per-chunk AES-256-GCM and sequence-number AAD

**Rationale**: Each plaintext chunk is independently encrypted with the same CEK but a unique IV. This allows individual chunk retry without re-encrypting earlier chunks, streaming decryption on the cloud side, and per-chunk integrity verification.

**Per-chunk wire format**:
```
nonce (12B) || ciphertext || auth_tag (16B)
```

**AAD binding**: `concat(sessionId, chunkIndex as uint32-BE, totalChunks as uint32-BE)` — prevents chunk reordering, cross-session substitution, and block swapping.

**Resumption**: Fixed chunk boundaries required. On resume, client queries `HEAD` for `Upload-Offset`, computes which chunk boundary that corresponds to, re-encrypts from that chunk. Chunk plan (count, size, total encrypted size) stored in the manifest.

**Alternative**: Encrypt-then-chunk — rejected because a single AES-GCM ciphertext can't be split and individually verified. Cloud must buffer the entire blob before checking the auth tag.

---

## R3: Serialization Format

### Decision: JSON envelope + raw binary blobs (multipart)

**Rationale**: Session metadata (identity, conversation history, config, policy cache) stays as JSON for debuggability and schema flexibility. Output artifacts are transferred as raw binary via separate upload slots, avoiding base64 bloat (33% overhead).

**Structure**:
- Manifest (JSON): `{ sessionId, tenantId, workspaceId, conversationHistory, pendingActions, runtimeConfig, policyCache, artifacts: [{ id, hash, size }] }`
- Artifacts: One tus upload per artifact blob.

**Upgrade path**: If envelope grows or latency tightens, replace JSON with CBOR (`cbor-x`) for streaming + native binary support. No schema management required.

**Alternatives Considered**:
- *Protocol Buffers*: 60-70% smaller but adds schema compilation toolchain. Overkill for private desktop-to-cloud handoff.
- *MessagePack*: 50% smaller but no indefinite-length streaming. Limited advantage over CBOR.
- *JSON with base64 artifacts*: Simple but 33% size penalty on binary data. Rejected.

---

## R4: Resumable Upload Protocol

### Decision: tus 1.0 protocol via `@tus/server` + `tus-js-client`

**Rationale**: Open HTTP standard (RFC 9110 based) with TypeScript-native server and client packages. Handles offset tracking, resume discovery (`HEAD` → `Upload-Offset`), conflict detection (409 on mismatch) out of the box.

**Flow**:
1. `POST` creates upload resource → returns `Location` URL
2. `HEAD` discovers current `Upload-Offset` (for resumption)
3. `PATCH` with `Content-Type: application/offset+octet-stream` transfers bytes
4. `409 Conflict` on offset mismatch prevents silent corruption

**Packages**: `@tus/server` (Express/Fastify middleware), `tus-js-client` (browser/Node.js client). Both TypeScript-native.

**Chunk size**: 5 MiB default (256 KiB aligned). At 100 Mbps, a 50 MiB session transfers in ~4 seconds. Even at 20 Mbps, fits within the 30-second SLA.

**Retry strategy**: Exponential backoff starting at 1s, cap at 30s. `HEAD` to rediscover offset before each retry.

**Alternative**: Custom chunked upload — rejected because it duplicates offset tracking, reassembly, and bookkeeping that tus provides.

---

## R5: Artifact Transfer Pattern

### Decision: Two-tier upload — manifest first, artifacts via separate tus upload slots

**Flow**:
1. `POST /sessions/{id}/manifest` — JSON envelope with artifact metadata (id, hash, size)
2. Response includes per-artifact upload URLs
3. Parallel tus uploads for each artifact blob (independently retryable)

**Rationale**: Server validates manifest immediately (auth, quota). Artifacts can be retried/parallelized independently. Large artifacts don't block metadata processing.

---

## Summary

| Topic | Decision | Key Driver |
|-------|----------|------------|
| Encryption scheme | Hybrid ECIES (X25519 + AES-256-GCM) | Forward secrecy, Node.js native support |
| Chunk encryption | Per-chunk AES-256-GCM with sequence AAD | Resumable transfer compatibility |
| Serialization | JSON envelope + binary multipart | Debuggability + no base64 penalty |
| Upload protocol | tus 1.0 | TypeScript-native, HTTP standard |
| Artifact handling | Separate tus uploads per artifact | Independent retry, parallel transfer |
| Chunk size | 5 MiB default | SLA math + encryption boundary alignment |
