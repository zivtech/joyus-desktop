import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn(),
    },
  };
});

import { checkVersion, autoSyncIfNeeded } from "../../src/sidecar/version-gate";
import { promises as fs } from "node:fs";

const mockReadFile = vi.mocked(fs.readFile);

function validConfig(version: string): string {
  return JSON.stringify({
    bundles: { "recon-operator-bundle": { version } },
  });
}

describe("version-gate", () => {
  beforeEach(() => {
    mockReadFile.mockReset();
  });

  // -------------------------------------------------------------------------
  // checkVersion
  // -------------------------------------------------------------------------

  describe("checkVersion", () => {
    it("returns match when deployed and pinned versions agree", async () => {
      mockReadFile.mockResolvedValueOnce(validConfig("1.2.0") as never);
      const getSyncStatus = vi.fn().mockResolvedValue({ version: "1.2.0" });

      const result = await checkVersion(getSyncStatus);

      expect(result).toEqual({
        current: "1.2.0",
        pinned: "1.2.0",
        match: true,
      });
    });

    it("returns mismatch when versions differ", async () => {
      mockReadFile.mockResolvedValueOnce(validConfig("2.0.0") as never);
      const getSyncStatus = vi.fn().mockResolvedValue({ version: "1.0.0" });

      const result = await checkVersion(getSyncStatus);

      expect(result).toEqual({
        current: "1.0.0",
        pinned: "2.0.0",
        match: false,
      });
    });

    it("returns stale when getSyncStatus throws", async () => {
      mockReadFile.mockResolvedValueOnce(validConfig("1.0.0") as never);
      const getSyncStatus = vi
        .fn()
        .mockRejectedValue(new Error("unavailable"));

      const result = await checkVersion(getSyncStatus);

      expect(result).toEqual({
        current: null,
        pinned: "1.0.0",
        match: false,
        stale: true,
      });
    });

    it("returns stale when getSyncStatus returns undefined", async () => {
      mockReadFile.mockResolvedValueOnce(validConfig("1.0.0") as never);
      const getSyncStatus = vi.fn().mockResolvedValue(undefined);

      const result = await checkVersion(getSyncStatus);

      expect(result).toEqual({
        current: null,
        pinned: "1.0.0",
        match: false,
        stale: true,
      });
    });

    it("returns stale when getSyncStatus returns null version", async () => {
      mockReadFile.mockResolvedValueOnce(validConfig("1.0.0") as never);
      const getSyncStatus = vi.fn().mockResolvedValue({ version: null });

      const result = await checkVersion(getSyncStatus);

      expect(result).toEqual({
        current: null,
        pinned: "1.0.0",
        match: false,
        stale: true,
      });
    });

    it("returns pinned:null when no config file is found", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));
      const getSyncStatus = vi.fn().mockResolvedValue({ version: "1.0.0" });

      const result = await checkVersion(getSyncStatus);

      expect(result).toEqual({
        current: "1.0.0",
        pinned: null,
        match: false,
      });
    });

    it("returns pinned:null when config has no bundles key", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({}) as never);
      const getSyncStatus = vi.fn().mockResolvedValue({ version: "1.0.0" });

      const result = await checkVersion(getSyncStatus);

      expect(result.pinned).toBeNull();
    });

    it("returns pinned:null when bundle exists without version", async () => {
      mockReadFile.mockResolvedValue(
        JSON.stringify({
          bundles: { "recon-operator-bundle": {} },
        }) as never,
      );
      const getSyncStatus = vi.fn().mockResolvedValue({ version: "1.0.0" });

      const result = await checkVersion(getSyncStatus);

      expect(result.pinned).toBeNull();
    });

    it("tries next candidate when first config read fails", async () => {
      mockReadFile
        .mockRejectedValueOnce(new Error("ENOENT"))
        .mockResolvedValueOnce(validConfig("3.0.0") as never);
      const getSyncStatus = vi.fn().mockResolvedValue({ version: "3.0.0" });

      const result = await checkVersion(getSyncStatus);

      expect(result.match).toBe(true);
      expect(result.pinned).toBe("3.0.0");
      expect(mockReadFile).toHaveBeenCalledTimes(2);
    });

    it("handles malformed JSON in config file", async () => {
      mockReadFile
        .mockResolvedValueOnce("not-json{" as never)
        .mockRejectedValue(new Error("ENOENT"));
      const getSyncStatus = vi.fn().mockResolvedValue({ version: "1.0.0" });

      const result = await checkVersion(getSyncStatus);

      expect(result.pinned).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // autoSyncIfNeeded
  // -------------------------------------------------------------------------

  describe("autoSyncIfNeeded", () => {
    it("skips sync when versions already match", async () => {
      mockReadFile.mockResolvedValue(validConfig("1.0.0") as never);
      const getSyncStatus = vi.fn().mockResolvedValue({ version: "1.0.0" });
      const triggerSync = vi.fn();

      const result = await autoSyncIfNeeded(getSyncStatus, triggerSync);

      expect(result.syncPerformed).toBe(false);
      expect(result.versionCheck.match).toBe(true);
      expect(triggerSync).not.toHaveBeenCalled();
    });

    it("syncs and re-checks when versions mismatch", async () => {
      mockReadFile.mockResolvedValue(validConfig("2.0.0") as never);
      const getSyncStatus = vi
        .fn()
        .mockResolvedValueOnce({ version: "1.0.0" })
        .mockResolvedValueOnce({ version: "2.0.0" });
      const triggerSync = vi.fn().mockResolvedValue(undefined);

      const result = await autoSyncIfNeeded(getSyncStatus, triggerSync);

      expect(result.syncPerformed).toBe(true);
      expect(result.versionCheck.match).toBe(true);
      expect(result.versionCheck.current).toBe("2.0.0");
      expect(triggerSync).toHaveBeenCalledOnce();
    });

    it("returns stale when triggerSync throws", async () => {
      mockReadFile.mockResolvedValue(validConfig("2.0.0") as never);
      const getSyncStatus = vi.fn().mockResolvedValue({ version: "1.0.0" });
      const triggerSync = vi.fn().mockRejectedValue(new Error("network"));

      const result = await autoSyncIfNeeded(getSyncStatus, triggerSync);

      expect(result.syncPerformed).toBe(true);
      expect(result.versionCheck.stale).toBe(true);
      expect(result.versionCheck.match).toBe(false);
    });

    it("reports mismatch when sync succeeds but versions still differ", async () => {
      mockReadFile.mockResolvedValue(validConfig("3.0.0") as never);
      const getSyncStatus = vi
        .fn()
        .mockResolvedValueOnce({ version: "1.0.0" })
        .mockResolvedValueOnce({ version: "2.0.0" });
      const triggerSync = vi.fn().mockResolvedValue(undefined);

      const result = await autoSyncIfNeeded(getSyncStatus, triggerSync);

      expect(result.syncPerformed).toBe(true);
      expect(result.versionCheck.match).toBe(false);
      expect(result.versionCheck.current).toBe("2.0.0");
      expect(result.versionCheck.pinned).toBe("3.0.0");
    });
  });
});
