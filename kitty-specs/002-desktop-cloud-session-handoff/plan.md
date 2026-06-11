# Implementation Plan: Desktop-to-Cloud Session Handoff

**Branch**: `002-desktop-cloud-session-handoff` | **Date**: 2026-03-09 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `kitty-specs/002-desktop-cloud-session-handoff/spec.md`

## Summary

Implement user-initiated session handoff from Joyus Desktop to the cloud, enabling users to continue work from another device. The handoff is policy-gated, E2E encrypted, and uses resumable chunked uploads via the tus protocol. The cloud reconstructs a fully functional session from the transferred snapshot.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 24 (minimum: >=22.13 or >=20.19 for X25519 Web Crypto API)
**Primary Dependencies**: Vitest, TypeScript, `tus-js-client`, `@tus/server`
**New Dependencies**: `tus-js-client` (desktop), `@tus/server` (cloud/test harness)
**Testing**: `pnpm typecheck`, `pnpm coverage` with 100% thresholds
**Target Platform**: macOS/Linux development, GitHub Actions CI
**Project Type**: Monorepo (`apps/*`, `packages/*`)

**Architecture Decisions** (from research):
- **Encryption**: Hybrid ECIES — X25519 key exchange + HKDF-SHA256 + AES-256-GCM per-chunk encryption
- **Serialization**: JSON envelope (manifest) + raw binary multipart (artifacts)
- **Upload protocol**: tus 1.0 for resumable chunked transfer (5 MiB chunks, 256 KiB aligned)
- **Control plane pattern**: MCP tool calls (`initiate_handoff`, `complete_handoff`, `handoff_status`) for coordination; separate tus HTTP endpoints for payload
- **Transfer recovery**: Automatic retry with exponential backoff (1s base, 30s cap); fallback to resumable transfer on retry exhaustion
- **Snapshot size limit**: 100 MiB maximum (manifest + artifacts); configurable per deployment

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| Open-Core Compatibility | PASS | Handoff contracts defined as control-plane MCP tools; desktop consumes documented interfaces. |
| No Desktop Lock-In | PASS | All handoff contracts are documented in `contracts/handoff-api.yaml`; any client can implement the protocol. |
| Security-First Enforcement | PASS | Handoff requires policy authorization via `verify_before_action` (medium-risk minimum). E2E encryption with forward secrecy. Fail-closed on policy unavailability. |
| Runtime Separation | PASS | Handoff respects tenant class; policy gating applies uniformly to internal and external tenants. |
| Full Coverage Gates | PASS | 100% coverage requirement maintained for all handoff modules. |

## Work Breakdown

### WP01: Handoff State Machine & Types

Define the core types and state machine for handoff lifecycle management.

- Define TypeScript types: `SessionSnapshot`, `HandoffRequest`, `HandoffReceipt`, `SnapshotManifest`, `ArtifactReference`, `HandoffState`
- Implement handoff state machine with transition validation (`initiated` → `authorizing` → `encrypting` → `transferring` → `completed` | `failed`)
- State transition guards (invalid transitions throw)
- 100% test coverage for all types and transitions

**Dependencies**: None (foundational)
**Modules**: `packages/policy-client/src/handoffTypes.ts`, `packages/policy-client/src/handoffStateMachine.ts`

### WP02: Snapshot Assembly

Assemble a complete session snapshot from desktop runtime state.

- Implement snapshot builder that collects: session identity, conversation history, pending action queue, runtime config, cached policy decisions, artifact references
- Snapshot validation (required fields, schema version)
- Manifest generation (chunk count, sizes, artifact metadata)
- 100% test coverage

**Dependencies**: WP01 (types)
**Modules**: `apps/desktop-companion/src/snapshotAssembly.ts`

### WP03: Policy-Gated Handoff Authorization

Integrate handoff initiation with the existing policy enforcement flow.

- Implement `requestHandoffAuthorization()` using existing `verify_before_action` MCP tool pattern from `controlPlaneContracts.ts`
- Handoff classified as medium-risk action
- Fail-closed on policy unavailability (all tenant classes)
- Handle `allow`, `deny`, `escalate` outcomes with user notification
- 100% test coverage for all policy outcome branches

**Dependencies**: WP01 (types), Feature 001 (policy enforcement)
**Modules**: `apps/desktop-companion/src/handoffAuthorization.ts`

### WP04: E2E Encryption & Chunking

Encrypt the snapshot for secure transfer using hybrid ECIES.

- Implement ECDH key agreement: receive cloud X25519 public key, generate ephemeral desktop key pair, derive CEK via HKDF-SHA256
- Per-chunk AES-256-GCM encryption with unique IV per chunk
- Sequence-number AAD binding (sessionId + chunkIndex + totalChunks) to prevent reordering
- Fixed chunk boundaries (5 MiB default) for resumable transfer compatibility
- Artifact encryption (same CEK, independent per-artifact)
- 100% test coverage including tampered-chunk and reordered-chunk rejection

**Dependencies**: WP01 (types), WP02 (snapshot assembly)
**Modules**: `packages/policy-client/src/snapshotEncryption.ts`

### WP05: Resumable Upload Client (tus)

Desktop-side tus client for uploading encrypted chunks and artifacts.

- Integrate `tus-js-client` for encrypted manifest upload
- Parallel artifact uploads via separate tus endpoints
- Automatic retry with exponential backoff (1s base, 30s cap, configurable max retries)
- Resumable fallback: on retry exhaustion, `HEAD` to discover offset and resume from last position
- Upload progress tracking for state machine updates
- 100% test coverage with mock tus server

**Dependencies**: WP01 (types), WP04 (encryption)
**Modules**: `apps/desktop-companion/src/handoffUpload.ts`

### WP06: MCP Handoff Contracts (Control Plane Client)

Desktop-side MCP tool call wrappers for handoff coordination.

- `initiate_handoff` — sends manifest, receives handoff_id + cloud public key + upload URLs
- `complete_handoff` — signals all uploads done, sends desktop ephemeral public key, receives `HandoffReceipt`
- `handoff_status` — polls handoff state during transfer
- Response parsing and validation (reuse patterns from `controlPlaneContracts.ts`)
- 100% test coverage

**Dependencies**: WP01 (types), existing `callMcpTool` from `controlPlaneContracts.ts`
**Modules**: `packages/policy-client/src/handoffContracts.ts`

### WP07: Handoff Orchestrator

Top-level coordinator that wires together authorization, encryption, upload, and state management.

- Orchestrate the full handoff flow: authorize → encrypt → initiate (get upload URLs) → upload → complete
- State machine transitions at each step
- Error handling and user notification for each failure mode
- Timeout management (30-second SLA awareness)
- Concurrent handoff prevention (reject if a handoff is already in progress for this session)
- 100% test coverage for all happy and error paths

**Dependencies**: WP01-WP06
**Modules**: `apps/desktop-companion/src/handoffOrchestrator.ts`

### WP08: Cloud Snapshot Verification & Session Reconstruction (Contracts)

Define the cloud-side contract expectations for snapshot verification and session creation. (Desktop-side test doubles implementing these contracts.)

- Define verification contract: decrypt, check integrity signatures, validate manifest against received data
- Define session reconstruction contract: create cloud session from decrypted snapshot
- Test doubles that simulate cloud behavior for integration testing
- 100% test coverage of contract expectations

**Dependencies**: WP01 (types), WP04 (encryption — for decryption counterpart)
**Modules**: `packages/policy-client/src/handoffVerification.ts`

## Risks

1. **X25519 Web Crypto API stability**: Requires Node.js >=22.13 or >=20.19. CI must pin compatible version.
2. **tus protocol overhead**: tus adds HTTP round-trips for offset discovery. Mitigated by small chunk count for typical sessions.
3. **Snapshot size growth**: Large conversation histories or many artifacts could challenge the 30-second SLA. Mitigated by parallel artifact uploads and chunking.
4. **Control-plane contract drift**: Cloud-side `initiate_handoff` / `complete_handoff` contracts must stay aligned with desktop expectations. Mitigated by OpenAPI spec in `contracts/`.
5. **Encryption key management in tests**: Test fixtures need deterministic key pairs for reproducible encryption tests. Use fixed test vectors.

## Exit Criteria

1. All acceptance scenarios in `spec.md` covered by automated tests.
2. `pnpm run ci` passes with 100% coverage for all handoff modules.
3. Handoff state machine covers all defined states and transitions.
4. E2E encryption with per-chunk integrity verification demonstrated in tests.
5. Resumable upload (retry + resume fallback) demonstrated in tests with simulated network failures.
6. No branch in handoff/encryption/upload modules is untested.
7. OpenAPI contract in `contracts/handoff-api.yaml` matches implemented MCP tool signatures.
