/**
 * Credential handler sidecar IPC methods.
 *
 * Registers three methods:
 *   credentials.save   — persist a single credential key=value to the credential store
 *   credentials.list   — enumerate allowlisted keys with isSet booleans (no values)
 *   credentials.verify — probe live APIs to confirm credentials are accepted
 *
 * Security invariants
 * -------------------
 * - Credential values are NEVER logged or returned.
 * - Only keys in CREDENTIAL_ALLOWLIST are accepted.
 * - The credential file is stored at 0o600 (owner read/write only).
 * - Writes are atomic: write to .tmp then rename.
 */

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { IpcHandler } from "./ipc-handler";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Returns the credential file path, computed lazily from os.homedir() so that
 * tests can mock os.homedir() and have the path resolve correctly.
 */
export function getCredentialFilePath(): string {
  return path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "com.joyus.desktop-companion",
    "credentials.env",
  );
}

/**
 * Stable reference for callers that need the path at a specific point in time.
 * In production, os.homedir() is always the same value so this is equivalent.
 * Prefer getCredentialFilePath() when testability matters.
 *
 * @deprecated Use getCredentialFilePath() in new code.
 */
export const CREDENTIAL_FILE_PATH = getCredentialFilePath();

export const CREDENTIAL_ALLOWLIST: readonly string[] = [
  "DATAFORSEO_LOGIN",
  "DATAFORSEO_PASSWORD",
  "CRUX_API_KEY",
  "ANTHROPIC_API_KEY",
  "PAGESPEED_API_KEY",
];

const VERIFY_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CredentialEntry {
  key: string;
  isSet: boolean;
}

interface VerifyEntry {
  key: string;
  valid: boolean | null;
  error?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Read the credential file and parse KEY=value lines into a Map.
 * Returns an empty Map if the file does not exist.
 */
async function readCredentials(filePath: string): Promise<Map<string, string>> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return new Map();
    }
    throw err;
  }

  const map = new Map<string, string>();
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    const value = line.slice(eqIdx + 1); // preserve raw value; no trim (passwords may have spaces)
    map.set(key, value);
  }
  return map;
}

/**
 * Serialize a Map of credentials back to KEY=value lines.
 */
function serializeCredentials(map: Map<string, string>): string {
  const lines: string[] = [];
  for (const [key, value] of map.entries()) {
    lines.push(`${key}=${value}`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Wrap a fetch call with a timeout. Resolves to the Response on success,
 * rejects with an Error on timeout or network failure.
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Public registration function
// ---------------------------------------------------------------------------

export function registerCredentialMethods(ipc: IpcHandler): void {
  // -------------------------------------------------------------------------
  // credentials.save
  // -------------------------------------------------------------------------
  ipc.registerMethod("credentials.save", async (params: unknown): Promise<unknown> => {
    if (params === null || typeof params !== "object") {
      throw new Error("credentials.save: params must be an object");
    }
    const p = params as Record<string, unknown>;

    if (typeof p["key"] !== "string" || p["key"] === "") {
      throw new Error("credentials.save: missing required field: key");
    }
    if (typeof p["value"] !== "string") {
      throw new Error("credentials.save: missing required field: value");
    }

    const key = p["key"] as string;
    const value = p["value"] as string;

    if (!CREDENTIAL_ALLOWLIST.includes(key)) {
      throw new Error(
        `credentials.save: key "${key}" is not in the allowlist. Allowed keys: ${CREDENTIAL_ALLOWLIST.join(", ")}`,
      );
    }

    // Create parent directory if needed
    const credFilePath = getCredentialFilePath();
    const dir = path.dirname(credFilePath);
    await fs.mkdir(dir, { recursive: true });

    // Read existing credentials
    const map = await readCredentials(credFilePath);

    // Update/add the key
    map.set(key, value);

    // Serialize
    const content = serializeCredentials(map);

    // Atomic write: write to .tmp then rename
    const tmpPath = `${credFilePath}.tmp`;
    await fs.writeFile(tmpPath, content, "utf8");
    await fs.rename(tmpPath, credFilePath);

    // Restrict file permissions to owner read/write only
    await fs.chmod(credFilePath, 0o600);

    // NEVER log or return the value
    return { saved: true, key };
  });

  // -------------------------------------------------------------------------
  // credentials.list
  // -------------------------------------------------------------------------
  ipc.registerMethod("credentials.list", async (_params: unknown): Promise<unknown> => {
    const map = await readCredentials(getCredentialFilePath());

    const result: CredentialEntry[] = CREDENTIAL_ALLOWLIST.map((key) => {
      const value = map.get(key);
      return { key, isSet: value !== undefined && value !== "" };
    });

    // NEVER return credential values
    return result;
  });

  // -------------------------------------------------------------------------
  // credentials.verify
  // -------------------------------------------------------------------------
  ipc.registerMethod("credentials.verify", async (_params: unknown): Promise<unknown> => {
    const map = await readCredentials(getCredentialFilePath());

    // Build verify tasks — one per key or logical group
    type VerifyTask = () => Promise<VerifyEntry | VerifyEntry[]>;
    const tasks: VerifyTask[] = [];

    // ANTHROPIC_API_KEY
    tasks.push(async (): Promise<VerifyEntry> => {
      const key = "ANTHROPIC_API_KEY";
      const apiKey = map.get(key);
      if (!apiKey) {
        return { key, valid: false, error: "not configured" };
      }
      try {
        const response = await fetchWithTimeout(
          "https://api.anthropic.com/v1/models",
          {
            method: "GET",
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
          },
          VERIFY_TIMEOUT_MS,
        );
        return { key, valid: response.status === 200 };
      } catch (err) {
        return { key, valid: false, error: (err as Error).message };
      }
    });

    // DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD (verified as a pair)
    tasks.push(async (): Promise<VerifyEntry[]> => {
      const loginKey = "DATAFORSEO_LOGIN";
      const passwordKey = "DATAFORSEO_PASSWORD";
      const login = map.get(loginKey);
      const password = map.get(passwordKey);

      if (!login && !password) {
        return [
          { key: loginKey, valid: false, error: "not configured" },
          { key: passwordKey, valid: false, error: "not configured" },
        ];
      }
      if (!login) {
        return [
          { key: loginKey, valid: false, error: "not configured" },
          { key: passwordKey, valid: false, error: "DATAFORSEO_LOGIN is not configured" },
        ];
      }
      if (!password) {
        return [
          { key: loginKey, valid: false, error: "DATAFORSEO_PASSWORD is not configured" },
          { key: passwordKey, valid: false, error: "not configured" },
        ];
      }

      const credentials = Buffer.from(`${login}:${password}`).toString("base64");
      try {
        const response = await fetchWithTimeout(
          "https://api.dataforseo.com/v3/appendix/user_data",
          {
            method: "GET",
            headers: {
              Authorization: `Basic ${credentials}`,
            },
          },
          VERIFY_TIMEOUT_MS,
        );
        const valid = response.status === 200;
        return [
          { key: loginKey, valid },
          { key: passwordKey, valid },
        ];
      } catch (err) {
        const error = (err as Error).message;
        return [
          { key: loginKey, valid: false, error },
          { key: passwordKey, valid: false, error },
        ];
      }
    });

    // CRUX_API_KEY — verification not implemented
    tasks.push(async (): Promise<VerifyEntry> => {
      return {
        key: "CRUX_API_KEY",
        valid: null,
        error: "verification not implemented",
      };
    });

    // PAGESPEED_API_KEY — verification not implemented
    tasks.push(async (): Promise<VerifyEntry> => {
      return {
        key: "PAGESPEED_API_KEY",
        valid: null,
        error: "verification not implemented",
      };
    });

    // Run all tasks in parallel; never throw
    const settled = await Promise.allSettled(tasks.map((t) => t()));

    const results: VerifyEntry[] = [];
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") {
        const value = outcome.value;
        if (Array.isArray(value)) {
          results.push(...value);
        } else {
          results.push(value);
        }
      } else {
        // Unexpected rejection — surface as error entry (key unknown at this level)
        results.push({ key: "unknown", valid: false, error: String(outcome.reason) });
      }
    }

    // Return in allowlist order
    const ordered: VerifyEntry[] = [];
    for (const allowedKey of CREDENTIAL_ALLOWLIST) {
      const entry = results.find((r) => r.key === allowedKey);
      if (entry !== undefined) {
        ordered.push(entry);
      }
    }

    return ordered;
  });
}
