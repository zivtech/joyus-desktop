import { Upload } from "tus-js-client";
import type { HttpRequest, HttpResponse } from "tus-js-client";
import type { EncryptedChunk, EncryptedArtifact } from "@joyus/policy-client";
import { HandoffError } from "@joyus/policy-client";

/**
 * Configuration for tus uploads.
 */
export interface UploadConfig {
  readonly uploadUrl: string;
  readonly chunkSize: number;
  readonly maxRetries: number;
  readonly baseRetryDelay: number;
  readonly maxRetryDelay: number;
  readonly onProgress?: (progress: UploadProgress) => void;
  readonly onError?: (error: Error) => void;
  readonly signal?: AbortSignal;
}

/**
 * Progress information for upload phases.
 */
export interface UploadProgress {
  readonly phase: "snapshot" | "artifacts";
  readonly bytesUploaded: number;
  readonly bytesTotal: number;
  readonly percentComplete: number;
  readonly artifactIndex?: number;
  readonly artifactCount?: number;
}

/**
 * Header structure embedded in the serialized blob.
 */
export interface ChunkHeader {
  readonly chunkCount: number;
  readonly chunks: ReadonlyArray<{
    readonly index: number;
    readonly ciphertextLength: number;
    readonly ivHex: string;
    readonly authTagHex: string;
    readonly aadHex: string;
  }>;
}

// Delimiter between JSON header and binary body
const HEADER_DELIMITER = Buffer.from("\n---CHUNKS---\n");

/**
 * Serialize encrypted chunks into a single binary blob.
 *
 * Format:
 *   [JSON header (UTF-8)] [delimiter] [ciphertext_0][ciphertext_1]...[ciphertext_N]
 *
 * The header contains chunk count, per-chunk sizes, IVs, auth tags, and AADs
 * so the receiver can parse the concatenated ciphertext.
 */
export function serializeEncryptedChunks(chunks: readonly EncryptedChunk[]): Buffer {
  const header: ChunkHeader = {
    chunkCount: chunks.length,
    chunks: chunks.map((c) => ({
      index: c.chunkIndex,
      ciphertextLength: c.ciphertext.length,
      ivHex: c.iv.toString("hex"),
      authTagHex: c.authTag.toString("hex"),
      aadHex: c.aad.toString("hex"),
    })),
  };

  const headerBuf = Buffer.from(JSON.stringify(header), "utf-8");
  const ciphertextParts = chunks.map((c) => c.ciphertext);

  return Buffer.concat([headerBuf, HEADER_DELIMITER, ...ciphertextParts]);
}

/**
 * Calculate retry delay with exponential backoff and jitter.
 *
 * Formula: min(baseDelay * 2^attempt, maxDelay) * (0.5 + random * 0.5)
 */
export function calculateRetryDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number
): number {
  const exponential = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  return exponential * (0.5 + Math.random() * 0.5);
}

/**
 * Build the retryDelays array for tus-js-client from config parameters.
 */
export function buildRetryDelays(
  maxRetries: number,
  baseDelay: number,
  maxDelay: number
): number[] {
  const delays: number[] = [];
  for (let i = 0; i < maxRetries; i++) {
    delays.push(calculateRetryDelay(i, baseDelay, maxDelay));
  }
  return delays;
}

/**
 * Discover the current upload offset by issuing a HEAD request to the tus resource URL.
 *
 * Returns the byte offset reported by the server.
 * Throws HandoffError with UPLOAD_FAILED if the resource is not found or the request fails.
 */
export async function discoverUploadOffset(uploadUrl: string): Promise<number> {
  let response: Response;
  try {
    response = await fetch(uploadUrl, {
      method: "HEAD",
      headers: {
        "Tus-Resumable": "1.0.0",
      },
    });
  } catch {
    throw new HandoffError("UPLOAD_FAILED", `Network error discovering upload offset for ${uploadUrl}`);
  }

  if (response.status === 404) {
    throw new HandoffError("UPLOAD_FAILED", `Upload resource not found: ${uploadUrl}`);
  }

  if (!response.ok) {
    throw new HandoffError("UPLOAD_FAILED", `HEAD request failed with status ${response.status}`);
  }

  const offsetHeader = response.headers.get("Upload-Offset");
  if (offsetHeader === null) {
    throw new HandoffError("UPLOAD_FAILED", "Upload-Offset header missing from HEAD response");
  }

  const offset = parseInt(offsetHeader, 10);
  if (isNaN(offset)) {
    throw new HandoffError("UPLOAD_FAILED", `Upload-Offset header is not a valid number: ${offsetHeader}`);
  }
  return offset;
}

/**
 * Resume an upload from the last known offset.
 *
 * Issues a HEAD to discover offset, then creates a new tus Upload starting from that position.
 */
export async function resumeUpload(
  uploadUrl: string,
  blob: Buffer,
  config: UploadConfig
): Promise<void> {
  const offset = await discoverUploadOffset(uploadUrl);

  return new Promise<void>((resolve, reject) => {
    const upload = new Upload(blob, {
      uploadUrl,  // tells tus-js-client to resume (skip creation); library issues its own HEAD
      retryDelays: [],  // no more retries on resume
      onError(err: Error) {
        config.onError?.(err);
        reject(new HandoffError("UPLOAD_FAILED", `Resume upload failed: ${err.message}`));
      },
      onSuccess() {
        resolve();
      },
    });

    if (config.signal) {
      if (config.signal.aborted) {
        upload.abort(true);
        reject(new HandoffError("UPLOAD_FAILED", "Upload aborted"));
        return;
      }
      config.signal.addEventListener("abort", () => {
        upload.abort(true);
        reject(new HandoffError("UPLOAD_FAILED", "Upload aborted"));
      }, { once: true });
    }

    upload.start();
  });
}

/**
 * Upload encrypted snapshot chunks to the tus endpoint.
 *
 * Serializes chunks into a binary blob, then uploads via tus protocol.
 * On retry exhaustion, attempts a resumable fallback via HEAD + resume.
 */
export async function uploadEncryptedSnapshot(
  chunks: readonly EncryptedChunk[],
  config: UploadConfig
): Promise<void> {
  const blob = serializeEncryptedChunks(chunks);
  const totalBytes = blob.length;

  // Emit initial progress
  config.onProgress?.({
    phase: "snapshot",
    bytesUploaded: 0,
    bytesTotal: totalBytes,
    percentComplete: 0,
  });

  return new Promise<void>((resolve, reject) => {
    let uploadUrl: string | null = null;
    let retryExhausted = false;

    const retryDelays = buildRetryDelays(
      config.maxRetries,
      config.baseRetryDelay,
      config.maxRetryDelay
    );

    const upload = new Upload(blob, {
      endpoint: config.uploadUrl,
      uploadSize: totalBytes,
      chunkSize: config.chunkSize,
      retryDelays,
      metadata: {
        contentType: "application/octet-stream",
        chunkCount: String(chunks.length),
      },
      onProgress(bytesUploaded: number, bytesTotal: number) {
        const percentComplete = bytesTotal > 0
          ? Math.round((bytesUploaded / bytesTotal) * 100)
          : 0;
        config.onProgress?.({
          phase: "snapshot",
          bytesUploaded,
          bytesTotal,
          percentComplete,
        });
      },
      onError(err: Error) {
        retryExhausted = true;
        config.onError?.(err);

        // Attempt resumable fallback if we have a resource URL
        if (uploadUrl || upload.url) {
          const resourceUrl = uploadUrl ?? upload.url!;
          resumeUpload(resourceUrl, blob, config)
            .then(resolve)
            .catch(() => {
              reject(
                new HandoffError("UPLOAD_FAILED", `Upload failed after retries and resume: ${err.message}`)
              );
            });
        } else {
          reject(
            new HandoffError("UPLOAD_FAILED", `Upload failed: ${err.message}`)
          );
        }
      },
      onSuccess() {
        config.onProgress?.({
          phase: "snapshot",
          bytesUploaded: totalBytes,
          bytesTotal: totalBytes,
          percentComplete: 100,
        });
        resolve();
      },
      onAfterResponse(_req: HttpRequest, _res: HttpResponse) {
        // Capture the upload URL from the creation response for potential resume
        if (!uploadUrl && upload.url) {
          uploadUrl = upload.url;
        }
      },
    });

    if (config.signal) {
      if (config.signal.aborted) {
        upload.abort(true);
        reject(new HandoffError("UPLOAD_FAILED", "Upload aborted"));
        return;
      }
      config.signal.addEventListener("abort", () => {
        upload.abort(true);
        if (!retryExhausted) {
          reject(new HandoffError("UPLOAD_FAILED", "Upload aborted"));
        }
      }, { once: true });
    }

    upload.start();
  });
}

/**
 * Upload encrypted artifacts in parallel, each to its own tus endpoint.
 *
 * If artifacts is empty, resolves immediately.
 * Throws UPLOAD_CONFIG_MISMATCH if uploadUrls.length !== artifacts.length.
 * Aborts all remaining uploads if any single upload fails.
 */
export async function uploadArtifacts(
  artifacts: readonly EncryptedArtifact[],
  uploadUrls: readonly string[],
  config: Omit<UploadConfig, "uploadUrl">
): Promise<void> {
  if (artifacts.length === 0) {
    return;
  }

  if (uploadUrls.length !== artifacts.length) {
    throw new HandoffError(
      "UPLOAD_CONFIG_MISMATCH",
      `Expected ${artifacts.length} upload URLs but received ${uploadUrls.length}`
    );
  }

  const abortController = new AbortController();
  const totalBytes = artifacts.reduce((sum, a) => sum + a.ciphertext.length + a.iv.length + a.authTag.length, 0);
  const perArtifactUploaded: number[] = new Array(artifacts.length).fill(0);

  // Link the external signal to our internal abort controller
  if (config.signal) {
    if (config.signal.aborted) {
      throw new HandoffError("UPLOAD_FAILED", "Upload aborted");
    }
    config.signal.addEventListener("abort", () => {
      abortController.abort();
    }, { once: true });
  }

  const emitAggregateProgress = (artifactIndex: number) => {
    const bytesUploaded = perArtifactUploaded.reduce((a, b) => a + b, 0);
    const percentComplete = totalBytes > 0
      ? Math.round((bytesUploaded / totalBytes) * 100)
      : 100;
    config.onProgress?.({
      phase: "artifacts",
      bytesUploaded,
      bytesTotal: totalBytes,
      percentComplete,
      artifactIndex,
      artifactCount: artifacts.length,
    });
  };

  // Emit initial progress
  config.onProgress?.({
    phase: "artifacts",
    bytesUploaded: 0,
    bytesTotal: totalBytes,
    percentComplete: 0,
    artifactIndex: 0,
    artifactCount: artifacts.length,
  });

  const promises = artifacts.map((artifact, index) => {
    return new Promise<void>((resolve, reject) => {
      // Wire format: [iv (12 bytes)][authTag (16 bytes)][ciphertext (N bytes)]
      const artifactData = Buffer.concat([artifact.iv, artifact.authTag, artifact.ciphertext]);
      const retryDelays = buildRetryDelays(
        config.maxRetries,
        config.baseRetryDelay,
        config.maxRetryDelay
      );

      const artifactEndpoint = uploadUrls[index]!;
      const upload = new Upload(artifactData, {
        endpoint: artifactEndpoint,
        uploadSize: artifactData.length,
        chunkSize: config.chunkSize,
        retryDelays,
        metadata: {
          artifactId: artifact.artifact_id,
          contentType: "application/octet-stream",
        },
        onProgress(bytesUploaded: number, _bytesTotal: number) {
          perArtifactUploaded[index] = bytesUploaded;
          emitAggregateProgress(index);
        },
        onError(err: Error) {
          // Abort all other uploads
          abortController.abort();
          config.onError?.(err);
          reject(
            new HandoffError("UPLOAD_FAILED", `Artifact upload failed (${artifact.artifact_id}): ${err.message}`)
          );
        },
        onSuccess() {
          perArtifactUploaded[index] = artifactData.length;
          emitAggregateProgress(index);
          resolve();
        },
      });

      // Listen for abort (either from failed sibling or external signal)
      abortController.signal.addEventListener("abort", () => {
        upload.abort(true);
      }, { once: true });

      if (abortController.signal.aborted) {
        reject(new HandoffError("UPLOAD_FAILED", "Upload aborted"));
        return;
      }

      upload.start();
    });
  });

  // Use Promise.allSettled to collect results, then throw the first error
  const results = await Promise.allSettled(promises);
  const firstRejection = results.find(
    (r): r is PromiseRejectedResult => r.status === "rejected"
  );

  if (firstRejection) {
    throw firstRejection.reason;
  }
}
