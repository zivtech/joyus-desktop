import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEVICE_ID_MAX_LENGTH,
  getDeviceIdFilePath,
  isValidDeviceId,
  resolveDeviceId,
  type DeviceIdFileSystem,
} from "../../src/sidecar/deviceId";

const UUID = "0f3b1c6e-9a4d-4e2b-8c7a-5d6e7f8a9b0c";

describe("resolveDeviceId", () => {
  let dir: string;
  let filePath: string;
  let warn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "joyus-device-id-"));
    filePath = join(dir, "nested", "state", "device-id");
    warn = vi.fn();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function resolve(env: NodeJS.ProcessEnv = {}, uuid: string = UUID): string | undefined {
    return resolveDeviceId({ env, logger: { warn }, filePath, randomUUID: () => uuid });
  }

  describe("JOYUS_DEVICE_ID override", () => {
    it("wins over the file, trimmed, and touches no file", async () => {
      expect(resolve({ JOYUS_DEVICE_ID: "  device-42  " })).toBe("device-42");
      await expect(stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("is cut to the contract's limit instead of dropped", () => {
      expect(resolve({ JOYUS_DEVICE_ID: "d".repeat(200) })).toBe("d".repeat(DEVICE_ID_MAX_LENGTH));
    });

    it.each([
      ["unset", {}],
      ["empty", { JOYUS_DEVICE_ID: "" }],
      ["whitespace", { JOYUS_DEVICE_ID: "   " }],
    ])("falls through to the file when %s", (_label, env) => {
      expect(resolve(env)).toBe(UUID);
    });

    it("falls through to the file when it contains non-printable characters", () => {
      expect(resolve({ JOYUS_DEVICE_ID: "bad\u0001id" })).toBe(UUID);
      expect(resolve({ JOYUS_DEVICE_ID: "two words" })).toBe(UUID);
    });
  });

  describe("persisted id", () => {
    it("creates the directory and file on first use, mode 0600, and reuses it", async () => {
      expect(resolve()).toBe(UUID);
      expect(await readFile(filePath, "utf8")).toBe(`${UUID}\n`);
      expect((await stat(filePath)).mode & 0o777).toBe(0o600);

      expect(resolve({}, "a-different-uuid-that-must-not-be-written")).toBe(UUID);
      expect(await readFile(filePath, "utf8")).toBe(`${UUID}\n`);
      expect(warn).not.toHaveBeenCalled();
    });

    it("reads a stored id with surrounding whitespace", async () => {
      await writeFile(join(dir, "device-id"), "  stored-id \n", "utf8");

      expect(
        resolveDeviceId({ env: {}, filePath: join(dir, "device-id"), randomUUID: () => UUID }),
      ).toBe("stored-id");
    });

    it.each([
      ["empty", ""],
      ["whitespace", "  \n"],
      ["too long", "x".repeat(DEVICE_ID_MAX_LENGTH + 1)],
      ["non-printable", "a\u0000b"],
    ])("replaces a stored id that is %s", async (_label, stored) => {
      const path = join(dir, "device-id");
      await writeFile(path, stored, "utf8");

      expect(resolveDeviceId({ env: {}, filePath: path, randomUUID: () => UUID })).toBe(UUID);
      expect(await readFile(path, "utf8")).toBe(`${UUID}\n`);
    });

    it("uses node's randomUUID by default", () => {
      const id = resolveDeviceId({ env: {}, filePath });

      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(resolveDeviceId({ env: {}, filePath })).toBe(id);
    });
  });

  describe("filesystem failure", () => {
    it("returns undefined and warns once with the error code, without throwing", () => {
      const fs: DeviceIdFileSystem = {
        readFileSync: () => {
          throw Object.assign(new Error("denied"), { code: "EACCES" });
        },
        mkdirSync: () => undefined,
        writeFileSync: () => {
          throw Object.assign(new Error("denied"), { code: "EACCES" });
        },
      };

      expect(resolveDeviceId({ env: {}, logger: { warn }, filePath, fs, randomUUID: () => UUID })).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toBe(
        "deviceId: cannot persist a device id (EACCES); polling without X-Joyus-Device-Id.",
      );
    });

    it("reports an unknown code when the failure is not an Error with a code", () => {
      const fs: DeviceIdFileSystem = {
        readFileSync: () => {
          throw new Error("no code");
        },
        mkdirSync: () => {
          throw "not an error object";
        },
        writeFileSync: () => undefined,
      };

      expect(resolveDeviceId({ env: {}, logger: { warn }, filePath, fs })).toBeUndefined();
      expect(warn.mock.calls[0]?.[0]).toContain("(unknown)");
    });

    it("stays silent with the default logger", async () => {
      const readOnly = join(dir, "ro");
      await writeFile(readOnly, "", "utf8");
      await chmod(readOnly, 0o400);

      // A regular file where a directory is needed makes mkdir fail.
      expect(resolveDeviceId({ env: {}, filePath: join(readOnly, "device-id") })).toBeUndefined();
    });
  });
});

describe("getDeviceIdFilePath", () => {
  it("lives in the desktop companion's Application Support directory", () => {
    const path = getDeviceIdFilePath();

    expect(path.endsWith(join("Library", "Application Support", "com.joyus.desktop-companion", "device-id"))).toBe(true);
  });
});

describe("isValidDeviceId", () => {
  it.each([
    ["a uuid", UUID, true],
    ["128 printable characters", "x".repeat(128), true],
    ["empty", "", false],
    ["129 characters", "x".repeat(129), false],
    ["a space", "a b", false],
    ["a control character", "a\tb", false],
    ["non-ascii", "héllo", false],
  ])("judges %s", (_label, value, expected) => {
    expect(isValidDeviceId(value)).toBe(expected);
  });
});
