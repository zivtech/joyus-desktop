import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openReplayCache } from "../src/replayCache";
import type { ReplayCache } from "../src/replayCache";

function makeTmpDbPath(): string {
  return join(tmpdir(), `replay-cache-test-${randomUUID()}`, "replay-cache.db");
}

function cleanupPath(dbPath: string): void {
  try {
    rmSync(join(dbPath, ".."), { recursive: true, force: true });
  } catch {
    // ignore
  }
}

describe("openReplayCache", () => {
  it("creates DB at custom path", () => {
    const dbPath = makeTmpDbPath();
    const cache = openReplayCache({ dbPath });
    expect(cache).toBeDefined();
    cache.close();
    cleanupPath(dbPath);
  });

  it("creates parent directory if missing", () => {
    const dbPath = makeTmpDbPath();
    // The parent directory does not exist; openReplayCache must create it
    const cache = openReplayCache({ dbPath });
    cache.close();
    expect(existsSync(join(dbPath, ".."))).toBe(true);
    cleanupPath(dbPath);
  });

  it("expands ~ in path", () => {
    // Stub HOME to a writable tmpdir so homedir() resolves within sandbox
    const fakeHome = join(tmpdir(), `fake-home-${randomUUID()}`);
    mkdirSync(fakeHome, { recursive: true });
    vi.stubEnv("HOME", fakeHome);

    try {
      const dbPath = `~/replay-cache-tilde/replay-cache.db`;
      const cache = openReplayCache({ dbPath });
      cache.close();
      expect(existsSync(join(fakeHome, "replay-cache-tilde"))).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it("creates DB at default path when no options given", () => {
    // Stub HOME to a writable tmpdir so the default ~/.joyus/replay-cache.db
    // resolves within the sandbox write boundary
    const fakeHome = join(tmpdir(), `fake-home-default-${randomUUID()}`);
    mkdirSync(fakeHome, { recursive: true });
    vi.stubEnv("HOME", fakeHome);

    try {
      const cache = openReplayCache();
      expect(cache).toBeDefined();
      cache.close();
      expect(existsSync(join(fakeHome, ".joyus"))).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });
});

describe("consume", () => {
  let cache: ReplayCache;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    cache = openReplayCache({ dbPath });
  });

  afterEach(() => {
    try {
      cache.close();
    } catch {
      // already closed
    }
    cleanupPath(dbPath);
  });

  const nowSec = (): number => Math.floor(Date.now() / 1000);

  it("first consume returns { ok: true }", () => {
    const result = cache.consume({
      jti: "jti-1",
      tenantId: "tenant-a",
      consumedAt: nowSec(),
      expiresAt: nowSec() + 3600
    });
    expect(result).toEqual({ ok: true });
  });

  it("second consume of same jti+tenantId returns { ok: false, originalConsumedAt }", () => {
    const consumedAt = nowSec();
    cache.consume({
      jti: "jti-dup",
      tenantId: "tenant-a",
      consumedAt,
      expiresAt: consumedAt + 3600
    });

    const result = cache.consume({
      jti: "jti-dup",
      tenantId: "tenant-a",
      consumedAt: consumedAt + 10,
      expiresAt: consumedAt + 3600
    });

    expect(result.ok).toBe(false);
    expect(result.originalConsumedAt).toBe(consumedAt);
  });

  it("different tenantId with same jti is treated as separate token", () => {
    const consumedAt = nowSec();
    cache.consume({
      jti: "jti-shared",
      tenantId: "tenant-a",
      consumedAt,
      expiresAt: consumedAt + 3600
    });

    const result = cache.consume({
      jti: "jti-shared",
      tenantId: "tenant-b",
      consumedAt,
      expiresAt: consumedAt + 3600
    });

    expect(result).toEqual({ ok: true });
  });
});

describe("prune", () => {
  let cache: ReplayCache;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    cache = openReplayCache({ dbPath });
  });

  afterEach(() => {
    try {
      cache.close();
    } catch {
      // already closed
    }
    cleanupPath(dbPath);
  });

  const nowSec = (): number => Math.floor(Date.now() / 1000);

  it("deletes expired tokens and returns count", () => {
    const past = nowSec() - 3600;
    cache.consume({ jti: "jti-old-1", tenantId: "tenant-a", consumedAt: past - 100, expiresAt: past });
    cache.consume({ jti: "jti-old-2", tenantId: "tenant-a", consumedAt: past - 200, expiresAt: past - 1 });
    cache.consume({ jti: "jti-valid", tenantId: "tenant-a", consumedAt: nowSec(), expiresAt: nowSec() + 3600 });

    const deleted = cache.prune();
    expect(deleted).toBe(2);
  });

  it("keeps valid tokens", () => {
    const consumedAt = nowSec();
    cache.consume({ jti: "jti-keep", tenantId: "tenant-a", consumedAt, expiresAt: consumedAt + 3600 });

    const deleted = cache.prune();
    expect(deleted).toBe(0);

    // Confirm token still blocks replay after pruning
    const result = cache.consume({
      jti: "jti-keep",
      tenantId: "tenant-a",
      consumedAt: consumedAt + 1,
      expiresAt: consumedAt + 3600
    });
    expect(result.ok).toBe(false);
  });

  it("returns 0 when nothing to prune", () => {
    const deleted = cache.prune();
    expect(deleted).toBe(0);
  });
});

describe("close", () => {
  it("close() completes without error", () => {
    const dbPath = makeTmpDbPath();
    const cache = openReplayCache({ dbPath });
    expect(() => cache.close()).not.toThrow();
    cleanupPath(dbPath);
  });
});
