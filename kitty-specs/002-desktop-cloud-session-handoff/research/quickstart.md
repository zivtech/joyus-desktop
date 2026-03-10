# Quickstart: Desktop-to-Cloud Session Handoff

## Overview

This feature adds user-initiated session handoff from the Joyus Desktop companion to the cloud. A user triggers a handoff, the desktop assembles an encrypted snapshot of their session, and transfers it to the cloud where the session is reconstructed.

## Key Flow

```
User triggers handoff
  → Desktop requests policy authorization (verify_before_action)
  → Policy allows → Desktop assembles session snapshot
  → Desktop receives cloud's X25519 public key via initiate_handoff MCP call
  → Desktop encrypts snapshot (per-chunk AES-256-GCM)
  → Desktop uploads encrypted chunks via tus protocol
  → Desktop uploads encrypted artifacts via parallel tus uploads
  → Desktop calls complete_handoff MCP tool with ephemeral public key
  → Cloud decrypts, verifies integrity, reconstructs session
  → User accesses cloud session from any device
```

## Module Map

```
apps/desktop-companion/src/
  handoffOrchestrator.ts     ← Top-level coordinator (WP07)
  handoffAuthorization.ts    ← Policy integration (WP03)
  snapshotAssembly.ts        ← Snapshot builder (WP02)
  handoffUpload.ts           ← tus upload client (WP05)

packages/policy-client/src/
  handoffTypes.ts            ← Core types (WP01)
  handoffStateMachine.ts     ← State transitions (WP01)
  handoffContracts.ts        ← MCP tool wrappers (WP06)
  snapshotEncryption.ts      ← E2E encryption (WP04)
  handoffVerification.ts     ← Cloud verification contracts (WP08)
```

## Dependencies

- **Existing**: `controlPlaneContracts.ts` (MCP tool call pattern, `callMcpTool`)
- **New**: `tus-js-client` (desktop upload), `@tus/server` (test harness)
- **Node.js**: >=22.13 or >=20.19 (X25519 Web Crypto API stability)

## Implementation Order

WP01 (types) → WP02 (snapshot) + WP03 (auth) in parallel → WP04 (encryption) → WP05 (upload) + WP06 (contracts) in parallel → WP07 (orchestrator) → WP08 (verification)
