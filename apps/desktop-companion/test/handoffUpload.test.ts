import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EncryptedChunk, EncryptedArtifact } from "@joyus/policy-client";
import { HandoffError } from "@joyus/policy-client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockOpts = Record<string, any>;

// Mock tus-js-client before importing the module under test
vi.mock("tus-js-client", () => {
  class MockUpload {
    file: unknown;
    options: MockOpts;
    url: string | null = null;

    constructor(file: unknown, options: MockOpts) {
      this.file = file;
      this.options = options;
    }

    start() {
      const onProgress = this.options.onProgress as
        | ((bytesUploaded: number, bytesTotal: number) => void)
        | undefined;
      const onSuccess = this.options.onSuccess as (() => void) | undefined;
      const onAfterResponse = this.options.onAfterResponse as
        | ((req: unknown, res: unknown) => void)
        | undefined;
      const uploadSize = this.options.uploadSize as number;

      this.url = `${this.options.endpoint as string}/files/${Math.random().toString(36).slice(2)}`;

      if (onAfterResponse) {
        onAfterResponse(null, {
          getStatus: () => 200,
          getHeader: () => undefined,
          getBody: () => "",
          getUnderlyingObject: () => null,
        });
      }

      if (onProgress) {
        onProgress(Math.floor(uploadSize / 2), uploadSize);
      }

      if (onSuccess) {
        queueMicrotask(() => onSuccess());
      }
    }

    abort(_shouldTerminate?: boolean): Promise<void> {
      return Promise.resolve();
    }
  }

  return {
    Upload: MockUpload,
  };
});

// Import after mock is set up
import {
  serializeEncryptedChunks,
  calculateRetryDelay,
  buildRetryDelays,
  discoverUploadOffset,
  resumeUpload,
  uploadEncryptedSnapshot,
  uploadArtifacts,
} from "../src/handoffUpload";
import type { UploadConfig, UploadProgress, ChunkHeader } from "../src/handoffUpload";
import { Upload as TusUpload } from "tus-js-client";

function createTestChunk(index: number, dataSize: number = 64): EncryptedChunk {
  return {
    chunkIndex: index,
    iv: Buffer.alloc(12, index + 1),
    ciphertext: Buffer.alloc(dataSize, index + 0x41),
    authTag: Buffer.alloc(16, index + 0xf0),
    aad: Buffer.from(`session-1:${index}:3`),
  };
}

function createTestArtifact(id: string, dataSize: number = 32): EncryptedArtifact {
  return {
    artifact_id: id,
    iv: Buffer.alloc(12, 0xaa),
    ciphertext: Buffer.alloc(dataSize, 0xbb),
    authTag: Buffer.alloc(16, 0xcc),
  };
}

function createTestConfig(overrides: Partial<UploadConfig> = {}): UploadConfig {
  return {
    uploadUrl: "https://tus.example.com/uploads",
    chunkSize: 5 * 1024 * 1024,
    maxRetries: 5,
    baseRetryDelay: 1000,
    maxRetryDelay: 30000,
    ...overrides,
  };
}

/** Helper to access mock internals from an Upload instance */
function getMockOpts(instance: { options: MockOpts }): MockOpts {
  return instance.options;
}

describe("serializeEncryptedChunks", () => {
  it("serializes zero chunks into a blob with empty header", () => {
    const blob = serializeEncryptedChunks([]);
    const delimiterStr = "\n---CHUNKS---\n";
    const delimiterIndex = blob.indexOf(delimiterStr);
    expect(delimiterIndex).toBeGreaterThan(0);

    const headerJson = blob.subarray(0, delimiterIndex).toString("utf-8");
    const header: ChunkHeader = JSON.parse(headerJson);
    expect(header.chunkCount).toBe(0);
    expect(header.chunks).toEqual([]);
  });

  it("serializes a single chunk with correct header and body", () => {
    const chunk = createTestChunk(0, 128);
    const blob = serializeEncryptedChunks([chunk]);

    const delimiterStr = "\n---CHUNKS---\n";
    const delimiterIndex = blob.indexOf(delimiterStr);
    const headerJson = blob.subarray(0, delimiterIndex).toString("utf-8");
    const header: ChunkHeader = JSON.parse(headerJson);

    expect(header.chunkCount).toBe(1);
    expect(header.chunks).toHaveLength(1);

    const c0 = header.chunks[0]!;
    expect(c0.index).toBe(0);
    expect(c0.ciphertextLength).toBe(128);
    expect(c0.ivHex).toBe(chunk.iv.toString("hex"));
    expect(c0.authTagHex).toBe(chunk.authTag.toString("hex"));
    expect(c0.aadHex).toBe(chunk.aad.toString("hex"));

    const body = blob.subarray(delimiterIndex + Buffer.byteLength(delimiterStr));
    expect(body.length).toBe(128);
    expect(body.equals(chunk.ciphertext)).toBe(true);
  });

  it("serializes multiple chunks with concatenated ciphertext", () => {
    const chunks = [createTestChunk(0, 64), createTestChunk(1, 96), createTestChunk(2, 48)];
    const blob = serializeEncryptedChunks(chunks);

    const delimiterStr = "\n---CHUNKS---\n";
    const delimiterIndex = blob.indexOf(delimiterStr);
    const headerJson = blob.subarray(0, delimiterIndex).toString("utf-8");
    const header: ChunkHeader = JSON.parse(headerJson);

    expect(header.chunkCount).toBe(3);
    expect(header.chunks).toHaveLength(3);

    const body = blob.subarray(delimiterIndex + Buffer.byteLength(delimiterStr));
    expect(body.length).toBe(64 + 96 + 48);

    let offset = 0;
    for (const chunk of chunks) {
      const part = body.subarray(offset, offset + chunk.ciphertext.length);
      expect(part.equals(chunk.ciphertext)).toBe(true);
      offset += chunk.ciphertext.length;
    }
  });
});

describe("calculateRetryDelay", () => {
  it("returns a value between 0.5*base and base for attempt 0", () => {
    const results: number[] = [];
    for (let i = 0; i < 100; i++) {
      results.push(calculateRetryDelay(0, 1000, 30000));
    }
    for (const r of results) {
      expect(r).toBeGreaterThanOrEqual(500);
      expect(r).toBeLessThanOrEqual(1000);
    }
  });

  it("doubles the base delay for each attempt", () => {
    for (let i = 0; i < 50; i++) {
      const delay = calculateRetryDelay(3, 1000, 30000);
      expect(delay).toBeGreaterThanOrEqual(4000);
      expect(delay).toBeLessThanOrEqual(8000);
    }
  });

  it("caps at maxDelay", () => {
    for (let i = 0; i < 50; i++) {
      const delay = calculateRetryDelay(10, 1000, 30000);
      expect(delay).toBeGreaterThanOrEqual(15000);
      expect(delay).toBeLessThanOrEqual(30000);
    }
  });

  it("returns correct range for attempt 1", () => {
    for (let i = 0; i < 50; i++) {
      const delay = calculateRetryDelay(1, 1000, 30000);
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(2000);
    }
  });
});

describe("buildRetryDelays", () => {
  it("builds an array of length maxRetries", () => {
    const delays = buildRetryDelays(5, 1000, 30000);
    expect(delays).toHaveLength(5);
  });

  it("returns empty array for zero retries", () => {
    const delays = buildRetryDelays(0, 1000, 30000);
    expect(delays).toHaveLength(0);
  });

  it("each delay is a positive number", () => {
    const delays = buildRetryDelays(5, 1000, 30000);
    for (const d of delays) {
      expect(d).toBeGreaterThan(0);
    }
  });

  it("delays generally increase with attempt", () => {
    const samples = 100;
    const avgDelays = [0, 0, 0, 0, 0];
    for (let s = 0; s < samples; s++) {
      const delays = buildRetryDelays(5, 1000, 30000);
      for (let i = 0; i < 5; i++) {
        avgDelays[i]! += delays[i]!;
      }
    }
    for (let i = 0; i < 5; i++) {
      avgDelays[i]! /= samples;
    }
    expect(avgDelays[0]!).toBeLessThan(avgDelays[4]!);
  });
});

describe("discoverUploadOffset", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns the offset from Upload-Offset header", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { "Upload-Offset": "12345" },
      })
    );

    const offset = await discoverUploadOffset("https://tus.example.com/uploads/abc");
    expect(offset).toBe(12345);
    expect(fetchSpy).toHaveBeenCalledWith("https://tus.example.com/uploads/abc", {
      method: "HEAD",
      headers: { "Tus-Resumable": "1.0.0" },
    });
  });

  it("returns 0 when Upload-Offset is 0", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { "Upload-Offset": "0" },
      })
    );

    const offset = await discoverUploadOffset("https://tus.example.com/uploads/abc");
    expect(offset).toBe(0);
  });

  it("throws UPLOAD_FAILED on 404", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 404 }));

    const err = await discoverUploadOffset("https://tus.example.com/uploads/abc").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HandoffError);
    expect((err as HandoffError).code).toBe("UPLOAD_FAILED");
    expect((err as HandoffError).message).toContain("not found");
  });

  it("throws UPLOAD_FAILED on non-OK status", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 500 }));

    await expect(discoverUploadOffset("https://tus.example.com/uploads/abc")).rejects.toThrow(
      HandoffError
    );
  });

  it("throws UPLOAD_FAILED on network error", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("Network failure"));

    const err = await discoverUploadOffset("https://tus.example.com/uploads/abc").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HandoffError);
    expect((err as HandoffError).code).toBe("UPLOAD_FAILED");
    expect((err as HandoffError).message).toContain("Network error");
  });

  it("throws UPLOAD_FAILED when Upload-Offset header is missing", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(discoverUploadOffset("https://tus.example.com/uploads/abc")).rejects.toThrow(
      "Upload-Offset header missing"
    );
  });
});

describe("uploadEncryptedSnapshot", () => {
  it("uploads serialized chunks successfully", async () => {
    const chunks = [createTestChunk(0), createTestChunk(1)];
    const config = createTestConfig();

    await expect(uploadEncryptedSnapshot(chunks, config)).resolves.toBeUndefined();
  });

  it("calls onProgress with snapshot phase", async () => {
    const chunks = [createTestChunk(0, 100)];
    const progressEvents: UploadProgress[] = [];
    const config = createTestConfig({
      onProgress: (p) => progressEvents.push(p),
    });

    await uploadEncryptedSnapshot(chunks, config);

    expect(progressEvents.length).toBeGreaterThanOrEqual(2);
    expect(progressEvents[0]!.phase).toBe("snapshot");
    expect(progressEvents[0]!.percentComplete).toBe(0);
    expect(progressEvents[progressEvents.length - 1]!.percentComplete).toBe(100);
  });

  it("rejects with UPLOAD_FAILED on error without upload URL", async () => {
    const originalStart = TusUpload.prototype.start;
    TusUpload.prototype.start = function (this: InstanceType<typeof TusUpload>) {
      const opts = getMockOpts(this as unknown as { options: MockOpts });
      const onError = opts.onError as (err: Error) => void;
      (this as unknown as { url: string | null }).url = null;
      queueMicrotask(() => onError(new Error("Connection refused")));
    };

    const chunks = [createTestChunk(0)];
    const config = createTestConfig();

    await expect(uploadEncryptedSnapshot(chunks, config)).rejects.toThrow(HandoffError);
    await expect(uploadEncryptedSnapshot(chunks, config)).rejects.toThrow("Upload failed");

    TusUpload.prototype.start = originalStart;
  });

  it("attempts resume fallback when upload URL is available", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { "Upload-Offset": "0" },
      })
    );

    let callCount = 0;
    const originalStart = TusUpload.prototype.start;

    TusUpload.prototype.start = function (this: InstanceType<typeof TusUpload>) {
      callCount++;
      const opts = getMockOpts(this as unknown as { options: MockOpts });

      if (callCount === 1) {
        (this as unknown as { url: string }).url = "https://tus.example.com/uploads/resource-123";
        const onError = opts.onError as (err: Error) => void;
        queueMicrotask(() => onError(new Error("Retry exhausted")));
      } else {
        const onSuccess = opts.onSuccess as () => void;
        queueMicrotask(() => onSuccess());
      }
    };

    const chunks = [createTestChunk(0)];
    const config = createTestConfig();

    await expect(uploadEncryptedSnapshot(chunks, config)).resolves.toBeUndefined();

    fetchSpy.mockRestore();
    TusUpload.prototype.start = originalStart;
  });

  it("rejects when both upload and resume fail", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValue(new Response(null, { status: 404 }));

    const originalStart = TusUpload.prototype.start;
    TusUpload.prototype.start = function (this: InstanceType<typeof TusUpload>) {
      (this as unknown as { url: string }).url = "https://tus.example.com/uploads/resource-123";
      const opts = getMockOpts(this as unknown as { options: MockOpts });
      const onError = opts.onError as (err: Error) => void;
      queueMicrotask(() => onError(new Error("Retry exhausted")));
    };

    const chunks = [createTestChunk(0)];
    const config = createTestConfig();

    await expect(uploadEncryptedSnapshot(chunks, config)).rejects.toThrow(HandoffError);
    await expect(uploadEncryptedSnapshot(chunks, config)).rejects.toThrow("retries and resume");

    fetchSpy.mockRestore();
    TusUpload.prototype.start = originalStart;
  });

  it("calls onError callback on failure", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValue(new Response(null, { status: 404 }));

    const originalStart = TusUpload.prototype.start;
    TusUpload.prototype.start = function (this: InstanceType<typeof TusUpload>) {
      (this as unknown as { url: string }).url = "https://tus.example.com/uploads/resource-123";
      const opts = getMockOpts(this as unknown as { options: MockOpts });
      const onError = opts.onError as (err: Error) => void;
      queueMicrotask(() => onError(new Error("test error")));
    };

    const errors: Error[] = [];
    const chunks = [createTestChunk(0)];
    const config = createTestConfig({ onError: (e) => errors.push(e) });

    await expect(uploadEncryptedSnapshot(chunks, config)).rejects.toThrow();
    expect(errors.length).toBeGreaterThanOrEqual(1);

    fetchSpy.mockRestore();
    TusUpload.prototype.start = originalStart;
  });

  it("aborts immediately if signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const chunks = [createTestChunk(0)];
    const config = createTestConfig({ signal: controller.signal });

    await expect(uploadEncryptedSnapshot(chunks, config)).rejects.toThrow("aborted");
  });

  it("aborts when signal fires during upload", async () => {
    const controller = new AbortController();

    const originalStart = TusUpload.prototype.start;
    TusUpload.prototype.start = function () {
      // Hang - don't call onSuccess
    };

    const chunks = [createTestChunk(0)];
    const config = createTestConfig({ signal: controller.signal });

    const promise = uploadEncryptedSnapshot(chunks, config);
    queueMicrotask(() => controller.abort());

    await expect(promise).rejects.toThrow("aborted");

    TusUpload.prototype.start = originalStart;
  });

  it("handles zero-size blob with 0% progress when bytesTotal is 0", async () => {
    const originalStart = TusUpload.prototype.start;
    TusUpload.prototype.start = function (this: InstanceType<typeof TusUpload>) {
      const opts = getMockOpts(this as unknown as { options: MockOpts });
      const onProgress = opts.onProgress as (bytesUploaded: number, bytesTotal: number) => void;
      const onSuccess = opts.onSuccess as () => void;
      this.url = `${opts.endpoint as string}/test`;
      if (onProgress) onProgress(0, 0);
      queueMicrotask(() => onSuccess());
    };

    const progressEvents: UploadProgress[] = [];
    const chunks: EncryptedChunk[] = [];
    const config = createTestConfig({
      onProgress: (p) => progressEvents.push(p),
    });

    await uploadEncryptedSnapshot(chunks, config);

    const tusProgressEvents = progressEvents.filter(
      (p) => p.phase === "snapshot" && p.bytesTotal === 0 && p.percentComplete === 0
    );
    expect(tusProgressEvents.length).toBeGreaterThanOrEqual(1);

    TusUpload.prototype.start = originalStart;
  });

  it("sets metadata with chunkCount and contentType", async () => {
    let capturedOptions: MockOpts | null = null;
    const originalStart = TusUpload.prototype.start;

    TusUpload.prototype.start = function (this: InstanceType<typeof TusUpload>) {
      capturedOptions = getMockOpts(this as unknown as { options: MockOpts });
      const onSuccess = capturedOptions.onSuccess as () => void;
      this.url = `${capturedOptions.endpoint as string}/test`;
      queueMicrotask(() => onSuccess());
    };

    const chunks = [createTestChunk(0), createTestChunk(1), createTestChunk(2)];
    const config = createTestConfig();

    await uploadEncryptedSnapshot(chunks, config);

    expect(capturedOptions).not.toBeNull();
    const metadata = capturedOptions!.metadata as Record<string, string>;
    expect(metadata.chunkCount).toBe("3");
    expect(metadata.contentType).toBe("application/octet-stream");

    TusUpload.prototype.start = originalStart;
  });

  it("configures tus Upload with correct retryDelays", async () => {
    let capturedOptions: MockOpts | null = null;
    const originalStart = TusUpload.prototype.start;

    TusUpload.prototype.start = function (this: InstanceType<typeof TusUpload>) {
      capturedOptions = getMockOpts(this as unknown as { options: MockOpts });
      const onSuccess = capturedOptions.onSuccess as () => void;
      this.url = `${capturedOptions.endpoint as string}/test`;
      queueMicrotask(() => onSuccess());
    };

    const chunks = [createTestChunk(0)];
    const config = createTestConfig({ maxRetries: 3 });

    await uploadEncryptedSnapshot(chunks, config);

    const retryDelays = capturedOptions!.retryDelays as number[];
    expect(retryDelays).toHaveLength(3);

    TusUpload.prototype.start = originalStart;
  });
});

describe("resumeUpload", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("resumes from discovered offset", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { "Upload-Offset": "500" },
      })
    );

    let capturedOptions: MockOpts | null = null;
    const originalStart = TusUpload.prototype.start;
    TusUpload.prototype.start = function (this: InstanceType<typeof TusUpload>) {
      capturedOptions = getMockOpts(this as unknown as { options: MockOpts });
      const onSuccess = capturedOptions.onSuccess as () => void;
      queueMicrotask(() => onSuccess());
    };

    const blob = Buffer.alloc(1024);
    const config = createTestConfig();

    await resumeUpload("https://tus.example.com/uploads/resource-123", blob, config);

    expect(capturedOptions).not.toBeNull();
    // Offset is passed via headers since uploadOffset is not in UploadOptions
    const headers = capturedOptions!.headers as Record<string, string>;
    expect(headers["Upload-Offset"]).toBe("500");
    expect(capturedOptions!.uploadUrl).toBe("https://tus.example.com/uploads/resource-123");

    TusUpload.prototype.start = originalStart;
  });

  it("rejects with UPLOAD_FAILED when HEAD fails", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 404 }));

    const blob = Buffer.alloc(1024);
    const config = createTestConfig();

    await expect(
      resumeUpload("https://tus.example.com/uploads/resource-123", blob, config)
    ).rejects.toThrow(HandoffError);
  });

  it("rejects with UPLOAD_FAILED when resume upload itself fails", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { "Upload-Offset": "0" },
      })
    );

    const originalStart = TusUpload.prototype.start;
    TusUpload.prototype.start = function (this: InstanceType<typeof TusUpload>) {
      const opts = getMockOpts(this as unknown as { options: MockOpts });
      const onError = opts.onError as (err: Error) => void;
      queueMicrotask(() => onError(new Error("Resume failed")));
    };

    const blob = Buffer.alloc(1024);
    const config = createTestConfig();

    await expect(
      resumeUpload("https://tus.example.com/uploads/resource-123", blob, config)
    ).rejects.toThrow("Resume upload failed");

    TusUpload.prototype.start = originalStart;
  });

  it("calls onError callback when resume fails", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { "Upload-Offset": "0" },
      })
    );

    const originalStart = TusUpload.prototype.start;
    TusUpload.prototype.start = function (this: InstanceType<typeof TusUpload>) {
      const opts = getMockOpts(this as unknown as { options: MockOpts });
      const onError = opts.onError as (err: Error) => void;
      queueMicrotask(() => onError(new Error("Resume failed")));
    };

    const errors: Error[] = [];
    const blob = Buffer.alloc(1024);
    const config = createTestConfig({ onError: (e) => errors.push(e) });

    await expect(
      resumeUpload("https://tus.example.com/uploads/resource-123", blob, config)
    ).rejects.toThrow();

    expect(errors).toHaveLength(1);

    TusUpload.prototype.start = originalStart;
  });

  it("aborts immediately if signal is already aborted", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { "Upload-Offset": "0" },
      })
    );

    const controller = new AbortController();
    controller.abort();

    const blob = Buffer.alloc(1024);
    const config = createTestConfig({ signal: controller.signal });

    await expect(
      resumeUpload("https://tus.example.com/uploads/resource-123", blob, config)
    ).rejects.toThrow("aborted");
  });

  it("aborts when signal fires during resume upload", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { "Upload-Offset": "0" },
      })
    );

    const controller = new AbortController();
    const originalStart = TusUpload.prototype.start;
    let abortCalled = false;
    const originalAbort = TusUpload.prototype.abort;
    TusUpload.prototype.abort = function (_shouldTerminate?: boolean): Promise<void> {
      abortCalled = true;
      return Promise.resolve();
    };
    TusUpload.prototype.start = function () {
      // Hang - don't call onSuccess or onError
    };

    const blob = Buffer.alloc(1024);
    const config = createTestConfig({ signal: controller.signal });

    const promise = resumeUpload("https://tus.example.com/uploads/resource-123", blob, config);
    await new Promise((r) => setTimeout(r, 5));
    controller.abort();

    await expect(promise).rejects.toThrow("aborted");
    expect(abortCalled).toBe(true);

    TusUpload.prototype.start = originalStart;
    TusUpload.prototype.abort = originalAbort;
  });
});

describe("uploadArtifacts", () => {
  it("resolves immediately for empty artifacts array", async () => {
    const config = createTestConfig();
    const { uploadUrl: _, ...configWithoutUrl } = config;
    await expect(uploadArtifacts([], [], configWithoutUrl)).resolves.toBeUndefined();
  });

  it("throws UPLOAD_CONFIG_MISMATCH when URL count differs from artifact count", async () => {
    const artifacts = [createTestArtifact("a1"), createTestArtifact("a2")];
    const urls = ["https://tus.example.com/uploads/a1"];
    const config = createTestConfig();
    const { uploadUrl: _, ...configWithoutUrl } = config;

    const err = await uploadArtifacts(artifacts, urls, configWithoutUrl).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HandoffError);
    expect((err as HandoffError).code).toBe("UPLOAD_CONFIG_MISMATCH");
    expect((err as HandoffError).message).toContain("Expected 2 upload URLs but received 1");
  });

  it("uploads multiple artifacts in parallel", async () => {
    const artifacts = [
      createTestArtifact("a1"),
      createTestArtifact("a2"),
      createTestArtifact("a3"),
    ];
    const urls = [
      "https://tus.example.com/uploads/a1",
      "https://tus.example.com/uploads/a2",
      "https://tus.example.com/uploads/a3",
    ];
    const config = createTestConfig();
    const { uploadUrl: _, ...configWithoutUrl } = config;

    await expect(
      uploadArtifacts(artifacts, urls, configWithoutUrl)
    ).resolves.toBeUndefined();
  });

  it("reports aggregate progress across artifacts", async () => {
    const progressEvents: UploadProgress[] = [];
    const artifacts = [createTestArtifact("a1", 100), createTestArtifact("a2", 200)];
    const urls = [
      "https://tus.example.com/uploads/a1",
      "https://tus.example.com/uploads/a2",
    ];
    const config = createTestConfig({
      onProgress: (p) => progressEvents.push(p),
    });
    const { uploadUrl: _, ...configWithoutUrl } = config;

    await uploadArtifacts(artifacts, urls, configWithoutUrl);

    expect(progressEvents.length).toBeGreaterThanOrEqual(1);
    const artEvents = progressEvents.filter((p) => p.phase === "artifacts");
    expect(artEvents.length).toBeGreaterThanOrEqual(1);
    expect(artEvents[0]!.artifactCount).toBe(2);
  });

  it("rejects when one artifact upload fails", async () => {
    const originalStart = TusUpload.prototype.start;
    let callIndex = 0;

    TusUpload.prototype.start = function (this: InstanceType<typeof TusUpload>) {
      const opts = getMockOpts(this as unknown as { options: MockOpts });
      const currentCall = callIndex++;

      if (currentCall === 1) {
        const onError = opts.onError as (err: Error) => void;
        queueMicrotask(() => onError(new Error("Artifact upload failed")));
      } else {
        const onSuccess = opts.onSuccess as () => void;
        this.url = `${opts.endpoint as string}/test`;
        queueMicrotask(() => onSuccess());
      }
    };

    const artifacts = [createTestArtifact("a1"), createTestArtifact("a2"), createTestArtifact("a3")];
    const urls = [
      "https://tus.example.com/uploads/a1",
      "https://tus.example.com/uploads/a2",
      "https://tus.example.com/uploads/a3",
    ];
    const config = createTestConfig();
    const { uploadUrl: _, ...configWithoutUrl } = config;

    await expect(uploadArtifacts(artifacts, urls, configWithoutUrl)).rejects.toThrow(
      HandoffError
    );

    TusUpload.prototype.start = originalStart;
    callIndex = 0;
  });

  it("calls onError callback when artifact fails", async () => {
    const originalStart = TusUpload.prototype.start;

    TusUpload.prototype.start = function (this: InstanceType<typeof TusUpload>) {
      const opts = getMockOpts(this as unknown as { options: MockOpts });
      const onError = opts.onError as (err: Error) => void;
      queueMicrotask(() => onError(new Error("fail")));
    };

    const errors: Error[] = [];
    const artifacts = [createTestArtifact("a1")];
    const urls = ["https://tus.example.com/uploads/a1"];
    const config = createTestConfig({ onError: (e) => errors.push(e) });
    const { uploadUrl: _, ...configWithoutUrl } = config;

    await expect(uploadArtifacts(artifacts, urls, configWithoutUrl)).rejects.toThrow();
    expect(errors.length).toBeGreaterThanOrEqual(1);

    TusUpload.prototype.start = originalStart;
  });

  it("aborts immediately if signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const artifacts = [createTestArtifact("a1")];
    const urls = ["https://tus.example.com/uploads/a1"];
    const config = createTestConfig({ signal: controller.signal });
    const { uploadUrl: _, ...configWithoutUrl } = config;

    await expect(uploadArtifacts(artifacts, urls, configWithoutUrl)).rejects.toThrow(
      "aborted"
    );
  });

  it("aborts remaining uploads when signal fires", async () => {
    const controller = new AbortController();
    const originalStart = TusUpload.prototype.start;

    let startCount = 0;
    TusUpload.prototype.start = function () {
      startCount++;
      // Hang - don't complete
    };

    const artifacts = [createTestArtifact("a1"), createTestArtifact("a2")];
    const urls = [
      "https://tus.example.com/uploads/a1",
      "https://tus.example.com/uploads/a2",
    ];
    const config = createTestConfig({ signal: controller.signal });
    const { uploadUrl: _, ...configWithoutUrl } = config;

    const _promise = uploadArtifacts(artifacts, urls, configWithoutUrl);
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();

    expect(startCount).toBe(2);

    TusUpload.prototype.start = originalStart;
  });

  it("handles zero-size artifacts with 100% progress", async () => {
    const progressEvents: UploadProgress[] = [];
    const artifacts = [createTestArtifact("a1", 0)];
    const urls = ["https://tus.example.com/uploads/a1"];
    const config = createTestConfig({
      onProgress: (p) => progressEvents.push(p),
    });
    const { uploadUrl: _, ...configWithoutUrl } = config;

    await uploadArtifacts(artifacts, urls, configWithoutUrl);

    const artEvents = progressEvents.filter((p) => p.phase === "artifacts");
    const hundredPctEvents = artEvents.filter((p) => p.percentComplete === 100);
    expect(hundredPctEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects artifact upload if abort fires between creation and start", async () => {
    const originalStart = TusUpload.prototype.start;

    let callCount = 0;
    TusUpload.prototype.start = function (this: InstanceType<typeof TusUpload>) {
      const opts = getMockOpts(this as unknown as { options: MockOpts });
      callCount++;

      if (callCount === 1) {
        const onError = opts.onError as (err: Error) => void;
        onError(new Error("immediate fail"));
      } else {
        const onSuccess = opts.onSuccess as () => void;
        this.url = `${opts.endpoint as string}/test`;
        queueMicrotask(() => onSuccess());
      }
    };

    const artifacts = [createTestArtifact("a1"), createTestArtifact("a2")];
    const urls = [
      "https://tus.example.com/uploads/a1",
      "https://tus.example.com/uploads/a2",
    ];
    const config = createTestConfig();
    const { uploadUrl: _, ...configWithoutUrl } = config;

    await expect(uploadArtifacts(artifacts, urls, configWithoutUrl)).rejects.toThrow(
      HandoffError
    );

    TusUpload.prototype.start = originalStart;
  });

  it("sets artifact metadata on each upload", async () => {
    const capturedMetadata: Array<Record<string, string>> = [];
    const originalStart = TusUpload.prototype.start;

    TusUpload.prototype.start = function (this: InstanceType<typeof TusUpload>) {
      const opts = getMockOpts(this as unknown as { options: MockOpts });
      capturedMetadata.push(opts.metadata as Record<string, string>);
      const onSuccess = opts.onSuccess as () => void;
      this.url = `${opts.endpoint as string}/test`;
      queueMicrotask(() => onSuccess());
    };

    const artifacts = [createTestArtifact("artifact-alpha"), createTestArtifact("artifact-beta")];
    const urls = [
      "https://tus.example.com/uploads/a1",
      "https://tus.example.com/uploads/a2",
    ];
    const config = createTestConfig();
    const { uploadUrl: _, ...configWithoutUrl } = config;

    await uploadArtifacts(artifacts, urls, configWithoutUrl);

    expect(capturedMetadata).toHaveLength(2);
    expect(capturedMetadata[0]!.artifactId).toBe("artifact-alpha");
    expect(capturedMetadata[1]!.artifactId).toBe("artifact-beta");

    TusUpload.prototype.start = originalStart;
  });
});
