---
work_package_id: "WP05"
subtasks:
  - "T020"
  - "T021"
  - "T022"
  - "T023"
  - "T024"
  - "T025"
title: "Resumable Upload Client (tus)"
phase: "Phase 4 - Transport"
lane: "done"
dependencies: ["WP01", "WP04"]
assignee: ""
agent: ""
shell_pid: ""
review_status: ""
reviewed_by: ""
history:
  - timestamp: "2026-03-10T15:13:40Z"
    lane: "planned"
    agent: "system"
    shell_pid: ""
    action: "Prompt generated via /spec-kitty.tasks"
---

# Work Package Prompt: WP05 – Resumable Upload Client (tus)

## Implementation Command

```bash
spec-kitty implement WP05 --base WP04
```

WP05 depends on WP01 and WP04. Use WP04 as base (which already includes WP01 and WP02).

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

- Integrate `tus-js-client` for uploading encrypted snapshot chunks to the cloud.
- Support parallel artifact uploads via separate tus endpoints.
- Implement retry with exponential backoff (1s base, 30s cap).
- Implement resumable fallback: HEAD to discover offset, resume from last position.
- Upload progress tracking for state machine updates.
- 100% line/function/branch/statement coverage with mock tus server.

## Context & Constraints

- **Research decisions**: R4 (tus 1.0 protocol, 5 MiB chunks, exponential backoff) from `research/research.md`.
- **Spec requirements**: FR-014 (automatic retry), FR-015 (resumable fallback).
- **Dependencies**: `tus-js-client` (new dependency — add to `apps/desktop-companion/package.json`), `@tus/server` (dev dependency for test harness).
- **API contract**: Upload URLs provided by `initiate_handoff` response (WP06 contracts).
- **Encryption**: Input is `EncryptedChunk[]` and `EncryptedArtifact[]` from WP04.

## Subtasks & Detailed Guidance

### Subtask T020 – Integrate tus-js-client for chunk upload

- **Purpose**: Upload encrypted snapshot chunks via tus protocol.
- **File**: `apps/desktop-companion/src/handoffUpload.ts`
- **Steps**:
  1. Add `tus-js-client` to `apps/desktop-companion/package.json` dependencies.
  2. Add `@tus/server` to dev dependencies (for testing).
  3. Define upload configuration interface:
     ```typescript
     export interface UploadConfig {
       uploadUrl: string;         // tus endpoint URL from initiate_handoff
       chunkSize: number;         // tus protocol chunk size (5 MiB)
       maxRetries: number;        // Default: 5
       baseRetryDelay: number;    // Default: 1000 (ms)
       maxRetryDelay: number;     // Default: 30000 (ms)
       onProgress?: (bytesUploaded: number, bytesTotal: number) => void;
       onError?: (error: Error) => void;
       signal?: AbortSignal;      // For timeout/cancellation
     }
     ```
  4. Implement `uploadEncryptedSnapshot(chunks: EncryptedChunk[], config: UploadConfig): Promise<void>`:
     - Serialize chunks into a single binary blob (concatenate chunk data with a header containing chunk metadata).
     - Create `tus.Upload` instance with the blob, endpoint URL, and chunk size.
     - Wire up `onProgress`, `onError`, `onSuccess` callbacks.
     - Start the upload.
     - Return a promise that resolves on success, rejects on unrecoverable error.
  5. Define serialization format for chunks:
     - Header: JSON metadata (chunk count, chunk sizes, IVs, AADs) followed by a delimiter.
     - Body: Concatenated ciphertext blobs.
     - This format allows the cloud to parse chunks after receiving the full blob.
- **Notes**: `tus-js-client` handles the tus protocol (POST to create, PATCH to upload chunks, HEAD to resume). We configure it; it handles the protocol.

### Subtask T021 – Implement parallel artifact uploads

- **Purpose**: Upload each encrypted artifact via its own tus upload slot for parallelism.
- **File**: `apps/desktop-companion/src/handoffUpload.ts`
- **Steps**:
  1. Implement `uploadArtifacts(artifacts: EncryptedArtifact[], uploadUrls: string[], config: Omit<UploadConfig, 'uploadUrl'>): Promise<void>`:
     - Each artifact gets its own upload URL (from `initiate_handoff` response).
     - Create one tus upload per artifact.
     - Run all uploads in parallel using `Promise.all`.
     - If any upload fails after retries, reject with the first error.
  2. Add per-artifact progress tracking that aggregates into overall progress.
- **Edge cases**:
  - No artifacts → resolve immediately.
  - Upload URL count mismatch with artifact count → throw `HandoffError` with code `'UPLOAD_CONFIG_MISMATCH'`.
  - One artifact fails → all remaining uploads should be aborted (use AbortController).

### Subtask T022 – Implement retry with exponential backoff

- **Purpose**: Automatically retry failed uploads before falling back to resume.
- **File**: `apps/desktop-companion/src/handoffUpload.ts`
- **Steps**:
  1. Implement `calculateRetryDelay(attempt: number, baseDelay: number, maxDelay: number): number`:
     - Formula: `Math.min(baseDelay * Math.pow(2, attempt), maxDelay)`.
     - Add jitter: `delay * (0.5 + Math.random() * 0.5)` to avoid thundering herd.
  2. Configure `tus-js-client` retry behavior:
     - Set `retryDelays` array based on config (e.g., `[1000, 2000, 4000, 8000, 16000]` for 5 retries with 1s base).
     - `tus-js-client` has built-in retry support — use `retryDelays` option.
  3. Track retry attempts for logging and progress reporting.
- **Notes**: `tus-js-client`'s `retryDelays` accepts an array of delays in ms. Generate this array from config parameters.

### Subtask T023 – Implement resumable fallback

- **Purpose**: After retry exhaustion, attempt to resume from the last successfully transferred position.
- **File**: `apps/desktop-companion/src/handoffUpload.ts`
- **Steps**:
  1. Implement `resumeUpload(uploadUrl: string, blob: Blob | Buffer, config: UploadConfig): Promise<void>`:
     - Issue HEAD request to the tus endpoint to discover current offset.
     - Create new `tus.Upload` with `uploadUrl` set to the existing resource URL.
     - Set `uploadOffset` to the discovered offset.
     - Resume upload from that point.
  2. Integration with main upload flow:
     - On retry exhaustion callback from tus-js-client, attempt `resumeUpload`.
     - If resume also fails → reject with `HandoffError` code `'UPLOAD_FAILED'`.
  3. Implement `discoverUploadOffset(uploadUrl: string): Promise<number>`:
     - Send HEAD request to the tus resource URL.
     - Parse `Upload-Offset` header.
     - Return offset in bytes.
- **Edge cases**:
  - HEAD returns 404 (resource expired) → treat as upload failed, not resumable.
  - HEAD returns 0 offset → restart from beginning.
  - Network error during HEAD → treat as upload failed.

### Subtask T024 – Implement upload progress tracking

- **Purpose**: Feed upload progress into the handoff state machine for UI updates.
- **File**: `apps/desktop-companion/src/handoffUpload.ts`
- **Steps**:
  1. Define progress event type:
     ```typescript
     export interface UploadProgress {
       phase: 'snapshot' | 'artifacts';
       bytesUploaded: number;
       bytesTotal: number;
       percentComplete: number;
       artifactIndex?: number;    // For artifact phase
       artifactCount?: number;
     }
     ```
  2. Aggregate progress across snapshot upload and artifact uploads.
  3. Call `onProgress` callback with `UploadProgress` events.
  4. Emit at least: start (0%), each tus chunk completion, snapshot complete, each artifact complete, all complete (100%).
- **Notes**: Progress is informational — upload correctness must not depend on progress callbacks.

### Subtask T025 – Write tests with mock tus server

- **Purpose**: Achieve 100% coverage using a realistic tus test harness.
- **File**: `apps/desktop-companion/src/handoffUpload.test.ts`
- **Steps**:
  1. **Mock tus server setup**: Use `@tus/server` to create an in-memory tus server for tests:
     ```typescript
     import { Server } from '@tus/server';
     import { FileStore } from '@tus/file-store';
     ```
     Start the server on a random port before tests, shut down after.
  2. **Test cases**:
     - **Successful upload**: Encrypt test data → upload → verify server received correct bytes.
     - **Retry on failure**: Configure server to fail first N requests → verify client retries and eventually succeeds.
     - **Resume after exhaustion**: Configure server to fail beyond retry limit → verify client issues HEAD and resumes.
     - **Parallel artifact upload**: Upload 3 test artifacts → verify all received.
     - **No artifacts**: Empty artifact array → resolves immediately.
     - **Upload URL mismatch**: Mismatched URL count → throws `UPLOAD_CONFIG_MISMATCH`.
     - **Progress events**: Verify progress callback fires with correct percentages.
     - **Abort signal**: Cancel mid-upload → verify upload stops cleanly.
     - **Exponential backoff**: Verify retry delays follow the formula.
  3. **HEAD fallback test**: Server returns offset → client resumes from that point.
  4. Run `pnpm coverage` — 100% required.
- **Notes**: If `@tus/server` is too heavy for unit tests, use HTTP mocks (e.g., `msw` or `nock`). The key is testing tus protocol behavior, not the server implementation.

## Test Strategy

- **Framework**: Vitest
- **Coverage**: 100% enforced
- **Tus test harness**: `@tus/server` with `FileStore` (tmpdir) or HTTP mocks
- **Parallelism**: Test parallel artifact uploads with at least 3 concurrent uploads

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| tus-js-client API changes | Pin version in package.json |
| Mock tus server fidelity | Use @tus/server for realistic protocol behavior |
| Race conditions in parallel uploads | Use Promise.all with proper error propagation |
| AbortController not cleaning up | Test abort mid-upload explicitly |

## Review Guidance

- Verify retry delay calculation matches spec (1s base, 30s cap, exponential with jitter).
- Verify resumable fallback correctly discovers offset via HEAD and resumes.
- Verify parallel artifact uploads handle partial failures (abort remaining on first failure).
- Verify chunk serialization format is documented and parseable.
- Confirm 100% coverage.

## Activity Log

- 2026-03-10T15:13:40Z – system – lane=planned – Prompt created.
