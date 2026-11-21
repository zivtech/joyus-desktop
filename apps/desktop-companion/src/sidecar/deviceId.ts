import { randomUUID as nodeRandomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * The device id a manifest poll presents as `X-Joyus-Device-Id` (spec 016,
 * contracts/manifest-endpoint.md). The service keys `consumer_checkpoints`
 * and its per-device rate limit on it, so the id must be stable across runs
 * and unique per machine. It is opaque to the service: recorded, never
 * trusted, and never derived from anything that names the machine or the
 * person.
 *
 * Resolution order:
 * 1. `JOYUS_DEVICE_ID`, trimmed and cut to the contract's 128-character
 *    limit, for operators who manage ids themselves.
 * 2. A UUID persisted in the sidecar's state directory (the same directory
 *    as `credentials.ts`), created on first use with mode 0600.
 * 3. Nothing, when the file can neither be read nor written. The poll then
 *    goes out without the header, and one warning says why.
 */

export const DEVICE_ID_MAX_LENGTH = 128;
const DEVICE_ID_PATTERN = /^[\x21-\x7e]+$/;
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

export interface DeviceIdLogger {
  readonly warn: (message: string) => void;
}

export interface DeviceIdFileSystem {
  readonly readFileSync: (path: string, encoding: "utf8") => string;
  readonly writeFileSync: (
    path: string,
    data: string,
    options: { encoding: "utf8"; mode: number },
  ) => void;
  readonly mkdirSync: (
    path: string,
    options: { recursive: true; mode: number },
  ) => unknown;
}

export interface ResolveDeviceIdOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly logger?: DeviceIdLogger;
  readonly filePath?: string;
  readonly fs?: DeviceIdFileSystem;
  readonly randomUUID?: () => string;
}

/** Computed lazily so tests can point `os.homedir()` elsewhere. */
export function getDeviceIdFilePath(): string {
  return join(
    homedir(),
    "Library",
    "Application Support",
    "com.joyus.desktop-companion",
    "device-id",
  );
}

/** A usable id: non-empty printable ASCII within the contract's limit. */
export function isValidDeviceId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= DEVICE_ID_MAX_LENGTH &&
    DEVICE_ID_PATTERN.test(value)
  );
}

function fromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const configured = env["JOYUS_DEVICE_ID"]?.trim() ?? "";
  if (configured === "") {
    return undefined;
  }

  const cut = configured.slice(0, DEVICE_ID_MAX_LENGTH);
  return isValidDeviceId(cut) ? cut : undefined;
}

function readPersisted(
  fs: DeviceIdFileSystem,
  filePath: string,
): string | undefined {
  try {
    const stored = fs.readFileSync(filePath, "utf8").trim();
    return isValidDeviceId(stored) ? stored : undefined;
  } catch {
    return undefined;
  }
}

function persist(
  fs: DeviceIdFileSystem,
  filePath: string,
  id: string,
  logger: DeviceIdLogger,
): string | undefined {
  try {
    fs.mkdirSync(dirname(filePath), { recursive: true, mode: DIR_MODE });
    fs.writeFileSync(filePath, `${id}\n`, { encoding: "utf8", mode: FILE_MODE });
    return id;
  } catch (error) {
    const code =
      error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : "unknown";
    logger.warn(
      `deviceId: cannot persist a device id (${code}); polling without X-Joyus-Device-Id.`,
    );
    return undefined;
  }
}

/**
 * Resolves the device id, creating and persisting one on first use. Never
 * throws: a filesystem problem yields undefined and one warning.
 */
export function resolveDeviceId(options: ResolveDeviceIdOptions): string | undefined {
  const configured = fromEnv(options.env);
  if (configured !== undefined) {
    return configured;
  }

  const fs: DeviceIdFileSystem = options.fs ?? { readFileSync, writeFileSync, mkdirSync };
  const filePath = options.filePath ?? getDeviceIdFilePath();
  const logger = options.logger ?? { warn: () => undefined };

  const stored = readPersisted(fs, filePath);
  if (stored !== undefined) {
    return stored;
  }

  return persist(fs, filePath, (options.randomUUID ?? nodeRandomUUID)(), logger);
}
