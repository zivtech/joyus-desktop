/**
 * Unit tests for apps/desktop-companion/src/sidecar/credentials.ts
 *
 * Strategy:
 * - `os.homedir()` is NOT mocked; instead, CREDENTIAL_FILE_PATH is a
 *   module-level constant that we cannot patch without vi.mock.  We mock
 *   the `node:os` module so that `os.homedir()` returns a temp directory,
 *   which causes CREDENTIAL_FILE_PATH (computed at module load time relative
 *   to the mocked homedir) to point into our temp dir.
 *
 *   NOTE: ESM module-level constants are evaluated at import time, so the
 *   mock must be declared before the production module is imported (Vitest
 *   hoists vi.mock() calls to the top of the file).
 *
 * - `global.fetch` is mocked for credentials.verify tests so no real HTTP
 *   calls are made.
 *
 * - File system calls (readFile, writeFile, rename, chmod, mkdir) are real
 *   and operate against a temp directory cleaned up after each test.
 */

import {
  describe,
  expect,
  it,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { mkdtempSync, mkdirSync, rmSync, existsSync as realExistsSync, statSync } from "node:fs";
import * as path from "node:path";
import * as nodeos from "node:os";

// ---------------------------------------------------------------------------
// Temp directory — created before any mocks so we know the real tmpdir
// ---------------------------------------------------------------------------

const REAL_TMPDIR = nodeos.tmpdir();

// ---------------------------------------------------------------------------
// Module-level mock for os
//
// vi.mock() is hoisted to the very top of the compiled output (before all
// variable declarations), so closures in the factory cannot reference any
// `const`/`let` defined in the test file.
//
// Solution: use vi.hoisted() to produce a value that IS available at hoist
// time, then reference it inside the vi.mock() factory.
// ---------------------------------------------------------------------------

const homedirBox = vi.hoisted(() => ({ value: "" }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: () => homedirBox.value,
  };
});

// ---------------------------------------------------------------------------
// Import production code AFTER mocks are declared
// ---------------------------------------------------------------------------

import { registerCredentialMethods, getCredentialFilePath, CREDENTIAL_ALLOWLIST } from "../../src/sidecar/credentials";
import type { IpcHandler, MethodHandler } from "../../src/sidecar/ipc-handler";

// ---------------------------------------------------------------------------
// IPC test harness (same pattern as recon.test.ts)
// ---------------------------------------------------------------------------

type InvokableMockIpc = IpcHandler & {
  _invoke: (method: string, params: unknown) => Promise<unknown>;
};

function makeIpc(): InvokableMockIpc {
  const methods = new Map<string, MethodHandler>();

  const ipc: InvokableMockIpc = {
    handleRequest: vi.fn() as never,
    registerMethod: vi.fn((name: string, handler: MethodHandler) => {
      methods.set(name, handler);
    }) as never,
    sendNotification: vi.fn() as never,
    _invoke: async (method: string, params: unknown): Promise<unknown> => {
      const h = methods.get(method);
      if (!h) throw new Error(`Method ${method} not registered`);
      return h(params);
    },
  };

  return ipc;
}

// ---------------------------------------------------------------------------
// Temp directory helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return mkdtempSync(path.join(REAL_TMPDIR, "credentials-test-"));
}

function removeTempDir(dir: string): void {
  if (realExistsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// credentialFilePath: helper that mirrors the production path formula.
// Used when we need the path before calling into the module (e.g., checking
// whether a directory was created). getCredentialFilePath() from the
// production module is used where post-mock resolution is needed.
// ---------------------------------------------------------------------------

function credentialFilePath(homeDir: string): string {
  return path.join(
    homeDir,
    "Library",
    "Application Support",
    "com.joyus.desktop-companion",
    "credentials.env",
  );
}

// ===========================================================================
// credentials.save
// ===========================================================================

describe("credentials.save", () => {
  let ipc: InvokableMockIpc;
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    homedirBox.value = tempDir;
    ipc = makeIpc();
    registerCredentialMethods(ipc);
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("saves a valid key and returns { saved: true, key }", async () => {
    const result = (await ipc._invoke("credentials.save", {
      key: "ANTHROPIC_API_KEY",
      value: "sk-test-abc123",
    })) as { saved: boolean; key: string };

    expect(result.saved).toBe(true);
    expect(result.key).toBe("ANTHROPIC_API_KEY");
  });

  it("does not return the credential value", async () => {
    const result = (await ipc._invoke("credentials.save", {
      key: "ANTHROPIC_API_KEY",
      value: "sk-secret",
    })) as Record<string, unknown>;

    expect("value" in result).toBe(false);
  });

  it("writes the key to the credential file", async () => {
    await ipc._invoke("credentials.save", {
      key: "CRUX_API_KEY",
      value: "crux-value-xyz",
    });

    const filePath = credentialFilePath(tempDir);
    expect(realExistsSync(filePath)).toBe(true);

    const { readFile } = await import("node:fs/promises");
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("CRUX_API_KEY=crux-value-xyz");
  });

  it("rejects a key that is not in the allowlist", async () => {
    await expect(
      ipc._invoke("credentials.save", {
        key: "NOT_ALLOWED_KEY",
        value: "some-value",
      }),
    ).rejects.toThrow("not in the allowlist");
  });

  it("rejects null params", async () => {
    await expect(ipc._invoke("credentials.save", null)).rejects.toThrow(
      "params must be an object",
    );
  });

  it("rejects missing key field", async () => {
    await expect(
      ipc._invoke("credentials.save", { value: "some-value" }),
    ).rejects.toThrow("missing required field: key");
  });

  it("rejects empty key field", async () => {
    await expect(
      ipc._invoke("credentials.save", { key: "", value: "some-value" }),
    ).rejects.toThrow("missing required field: key");
  });

  it("rejects missing value field", async () => {
    await expect(
      ipc._invoke("credentials.save", { key: "ANTHROPIC_API_KEY" }),
    ).rejects.toThrow("missing required field: value");
  });

  it("creates parent directory if it does not exist", async () => {
    const filePath = credentialFilePath(tempDir);
    const dir = path.dirname(filePath);

    expect(realExistsSync(dir)).toBe(false);

    await ipc._invoke("credentials.save", {
      key: "ANTHROPIC_API_KEY",
      value: "sk-abc",
    });

    expect(realExistsSync(dir)).toBe(true);
  });

  it("writes file with 0o600 permissions", async () => {
    await ipc._invoke("credentials.save", {
      key: "ANTHROPIC_API_KEY",
      value: "sk-abc",
    });

    const filePath = credentialFilePath(tempDir);
    const stat = statSync(filePath);
    // 0o600 = 384 decimal; mask with 0o777 to ignore file type bits
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("uses atomic write: .tmp file is renamed to final path", async () => {
    // After the call completes, no .tmp file should remain
    await ipc._invoke("credentials.save", {
      key: "ANTHROPIC_API_KEY",
      value: "sk-abc",
    });

    const filePath = credentialFilePath(tempDir);
    const tmpPath = `${filePath}.tmp`;

    expect(realExistsSync(filePath)).toBe(true);
    expect(realExistsSync(tmpPath)).toBe(false);
  });

  it("preserves existing keys when adding a new key", async () => {
    await ipc._invoke("credentials.save", {
      key: "ANTHROPIC_API_KEY",
      value: "sk-first",
    });
    await ipc._invoke("credentials.save", {
      key: "CRUX_API_KEY",
      value: "crux-second",
    });

    const filePath = credentialFilePath(tempDir);
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(filePath, "utf8");

    expect(content).toContain("ANTHROPIC_API_KEY=sk-first");
    expect(content).toContain("CRUX_API_KEY=crux-second");
  });

  it("updates an existing key without duplicating it", async () => {
    await ipc._invoke("credentials.save", {
      key: "ANTHROPIC_API_KEY",
      value: "sk-old",
    });
    await ipc._invoke("credentials.save", {
      key: "ANTHROPIC_API_KEY",
      value: "sk-new",
    });

    const filePath = credentialFilePath(tempDir);
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(filePath, "utf8");

    expect(content).toContain("ANTHROPIC_API_KEY=sk-new");
    expect(content).not.toContain("sk-old");

    // Ensure no duplicate keys
    const lines = content.split("\n").filter((l) => l.includes("ANTHROPIC_API_KEY="));
    expect(lines).toHaveLength(1);
  });

  it("accepts all 5 allowlist keys", async () => {
    for (const key of CREDENTIAL_ALLOWLIST) {
      const result = (await ipc._invoke("credentials.save", {
        key,
        value: `val-for-${key}`,
      })) as { saved: boolean; key: string };
      expect(result.saved).toBe(true);
      expect(result.key).toBe(key);
    }
  });
});

// ===========================================================================
// credentials.list
// ===========================================================================

describe("credentials.list", () => {
  let ipc: InvokableMockIpc;
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    homedirBox.value = tempDir;
    ipc = makeIpc();
    registerCredentialMethods(ipc);
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("re-throws non-ENOENT errors from readCredentials", async () => {
    // Create credentials.env as a directory so readFile throws EISDIR
    const filePath = credentialFilePath(tempDir);
    mkdirSync(filePath, { recursive: true });

    await expect(ipc._invoke("credentials.list", {})).rejects.toThrow();
  });

  it("ignores malformed lines (no = sign) and comment lines in credential file", async () => {
    // Write a credential file with comments, blank lines, and a malformed line
    const filePath = credentialFilePath(tempDir);
    const dir = path.dirname(filePath);
    mkdirSync(dir, { recursive: true });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      filePath,
      "# this is a comment\nmalformed-no-equals\nANTHROPIC_API_KEY=sk-valid\n\n",
      "utf8",
    );

    const result = (await ipc._invoke(
      "credentials.list",
      {},
    )) as Array<{ key: string; isSet: boolean }>;

    const anthropic = result.find((r) => r.key === "ANTHROPIC_API_KEY");
    expect(anthropic?.isSet).toBe(true);
  });

  it("returns all 5 allowlist keys in order when no credentials are set", async () => {
    const result = (await ipc._invoke(
      "credentials.list",
      {},
    )) as Array<{ key: string; isSet: boolean }>;

    expect(result).toHaveLength(5);
    const keys = result.map((r) => r.key);
    expect(keys).toEqual([...CREDENTIAL_ALLOWLIST]);
  });

  it("returns isSet: false for all keys when credential file is absent", async () => {
    const result = (await ipc._invoke(
      "credentials.list",
      {},
    )) as Array<{ key: string; isSet: boolean }>;

    for (const entry of result) {
      expect(entry.isSet).toBe(false);
    }
  });

  it("returns isSet: true for a key that has been saved", async () => {
    await ipc._invoke("credentials.save", {
      key: "ANTHROPIC_API_KEY",
      value: "sk-abc",
    });

    const result = (await ipc._invoke(
      "credentials.list",
      {},
    )) as Array<{ key: string; isSet: boolean }>;

    const anthropicEntry = result.find((r) => r.key === "ANTHROPIC_API_KEY");
    expect(anthropicEntry?.isSet).toBe(true);

    // All others remain false
    for (const entry of result) {
      if (entry.key !== "ANTHROPIC_API_KEY") {
        expect(entry.isSet).toBe(false);
      }
    }
  });

  it("returns isSet: false for an empty-value key", async () => {
    await ipc._invoke("credentials.save", {
      key: "ANTHROPIC_API_KEY",
      value: "",
    });

    const result = (await ipc._invoke(
      "credentials.list",
      {},
    )) as Array<{ key: string; isSet: boolean }>;

    const anthropicEntry = result.find((r) => r.key === "ANTHROPIC_API_KEY");
    expect(anthropicEntry?.isSet).toBe(false);
  });

  it("never returns credential values in the response", async () => {
    await ipc._invoke("credentials.save", {
      key: "CRUX_API_KEY",
      value: "my-secret-crux-key",
    });

    const result = (await ipc._invoke(
      "credentials.list",
      {},
    )) as Array<Record<string, unknown>>;

    for (const entry of result) {
      expect("value" in entry).toBe(false);
      expect(JSON.stringify(entry)).not.toContain("my-secret-crux-key");
    }
  });

  it("round-trip: save then list shows isSet: true", async () => {
    await ipc._invoke("credentials.save", {
      key: "DATAFORSEO_LOGIN",
      value: "user@example.com",
    });
    await ipc._invoke("credentials.save", {
      key: "DATAFORSEO_PASSWORD",
      value: "s3cr3t",
    });

    const result = (await ipc._invoke(
      "credentials.list",
      {},
    )) as Array<{ key: string; isSet: boolean }>;

    const loginEntry = result.find((r) => r.key === "DATAFORSEO_LOGIN");
    const passwordEntry = result.find((r) => r.key === "DATAFORSEO_PASSWORD");

    expect(loginEntry?.isSet).toBe(true);
    expect(passwordEntry?.isSet).toBe(true);
  });
});

// ===========================================================================
// credentials.verify
// ===========================================================================

describe("credentials.verify", () => {
  let ipc: InvokableMockIpc;
  let tempDir: string;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    tempDir = makeTempDir();
    homedirBox.value = tempDir;
    ipc = makeIpc();
    registerCredentialMethods(ipc);
    originalFetch = global.fetch;
  });

  afterEach(() => {
    removeTempDir(tempDir);
    global.fetch = originalFetch;
  });

  it("returns an array with one entry per allowlist key", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 } as Response);

    const result = (await ipc._invoke(
      "credentials.verify",
      {},
    )) as Array<{ key: string; valid: boolean | null; error?: string }>;

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(CREDENTIAL_ALLOWLIST.length);
  });

  it("returns entries in allowlist order", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 } as Response);

    const result = (await ipc._invoke(
      "credentials.verify",
      {},
    )) as Array<{ key: string }>;

    const keys = result.map((r) => r.key);
    expect(keys).toEqual([...CREDENTIAL_ALLOWLIST]);
  });

  it("returns valid: null with error for CRUX_API_KEY (not implemented)", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 } as Response);

    const result = (await ipc._invoke(
      "credentials.verify",
      {},
    )) as Array<{ key: string; valid: boolean | null; error?: string }>;

    const crux = result.find((r) => r.key === "CRUX_API_KEY");
    expect(crux?.valid).toBeNull();
    expect(crux?.error).toBe("verification not implemented");
  });

  it("returns valid: null with error for PAGESPEED_API_KEY (not implemented)", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 } as Response);

    const result = (await ipc._invoke(
      "credentials.verify",
      {},
    )) as Array<{ key: string; valid: boolean | null; error?: string }>;

    const pagespeed = result.find((r) => r.key === "PAGESPEED_API_KEY");
    expect(pagespeed?.valid).toBeNull();
    expect(pagespeed?.error).toBe("verification not implemented");
  });

  it("returns valid: false with 'not configured' when ANTHROPIC_API_KEY is absent", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 } as Response);

    const result = (await ipc._invoke(
      "credentials.verify",
      {},
    )) as Array<{ key: string; valid: boolean | null; error?: string }>;

    const anthropic = result.find((r) => r.key === "ANTHROPIC_API_KEY");
    expect(anthropic?.valid).toBe(false);
    expect(anthropic?.error).toContain("not configured");
  });

  it("returns valid: true when ANTHROPIC_API_KEY is set and API responds 200", async () => {
    await ipc._invoke("credentials.save", {
      key: "ANTHROPIC_API_KEY",
      value: "sk-test",
    });

    global.fetch = vi.fn().mockResolvedValue({ status: 200 } as Response);

    const result = (await ipc._invoke(
      "credentials.verify",
      {},
    )) as Array<{ key: string; valid: boolean | null; error?: string }>;

    const anthropic = result.find((r) => r.key === "ANTHROPIC_API_KEY");
    expect(anthropic?.valid).toBe(true);
    expect(anthropic?.error).toBeUndefined();
  });

  it("returns valid: false when ANTHROPIC_API_KEY API responds non-200", async () => {
    await ipc._invoke("credentials.save", {
      key: "ANTHROPIC_API_KEY",
      value: "sk-bad",
    });

    global.fetch = vi.fn().mockResolvedValue({ status: 401 } as Response);

    const result = (await ipc._invoke(
      "credentials.verify",
      {},
    )) as Array<{ key: string; valid: boolean | null; error?: string }>;

    const anthropic = result.find((r) => r.key === "ANTHROPIC_API_KEY");
    expect(anthropic?.valid).toBe(false);
  });

  it("returns valid: false with error message when ANTHROPIC_API_KEY fetch throws", async () => {
    await ipc._invoke("credentials.save", {
      key: "ANTHROPIC_API_KEY",
      value: "sk-test",
    });

    global.fetch = vi.fn().mockRejectedValue(new Error("network failure"));

    const result = (await ipc._invoke(
      "credentials.verify",
      {},
    )) as Array<{ key: string; valid: boolean | null; error?: string }>;

    const anthropic = result.find((r) => r.key === "ANTHROPIC_API_KEY");
    expect(anthropic?.valid).toBe(false);
    expect(anthropic?.error).toContain("network failure");
  });

  it("returns valid: false for both DATAFORSEO keys when neither is configured", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 } as Response);

    const result = (await ipc._invoke(
      "credentials.verify",
      {},
    )) as Array<{ key: string; valid: boolean | null; error?: string }>;

    const login = result.find((r) => r.key === "DATAFORSEO_LOGIN");
    const password = result.find((r) => r.key === "DATAFORSEO_PASSWORD");

    expect(login?.valid).toBe(false);
    expect(password?.valid).toBe(false);
  });

  it("returns valid: true for both DATAFORSEO keys when API responds 200", async () => {
    await ipc._invoke("credentials.save", {
      key: "DATAFORSEO_LOGIN",
      value: "user@test.com",
    });
    await ipc._invoke("credentials.save", {
      key: "DATAFORSEO_PASSWORD",
      value: "p@ssword",
    });

    global.fetch = vi.fn().mockResolvedValue({ status: 200 } as Response);

    const result = (await ipc._invoke(
      "credentials.verify",
      {},
    )) as Array<{ key: string; valid: boolean | null; error?: string }>;

    const login = result.find((r) => r.key === "DATAFORSEO_LOGIN");
    const password = result.find((r) => r.key === "DATAFORSEO_PASSWORD");

    expect(login?.valid).toBe(true);
    expect(password?.valid).toBe(true);
  });

  it("returns valid: false for both DATAFORSEO keys when fetch throws", async () => {
    await ipc._invoke("credentials.save", {
      key: "DATAFORSEO_LOGIN",
      value: "user@test.com",
    });
    await ipc._invoke("credentials.save", {
      key: "DATAFORSEO_PASSWORD",
      value: "p@ssword",
    });

    global.fetch = vi.fn().mockRejectedValue(new Error("connection refused"));

    const result = (await ipc._invoke(
      "credentials.verify",
      {},
    )) as Array<{ key: string; valid: boolean | null; error?: string }>;

    const login = result.find((r) => r.key === "DATAFORSEO_LOGIN");
    const password = result.find((r) => r.key === "DATAFORSEO_PASSWORD");

    expect(login?.valid).toBe(false);
    expect(password?.valid).toBe(false);
    expect(login?.error).toContain("connection refused");
  });

  it("returns valid: false for DATAFORSEO_LOGIN when only DATAFORSEO_PASSWORD is missing", async () => {
    await ipc._invoke("credentials.save", {
      key: "DATAFORSEO_LOGIN",
      value: "user@test.com",
    });

    global.fetch = vi.fn().mockResolvedValue({ status: 200 } as Response);

    const result = (await ipc._invoke(
      "credentials.verify",
      {},
    )) as Array<{ key: string; valid: boolean | null; error?: string }>;

    const login = result.find((r) => r.key === "DATAFORSEO_LOGIN");
    const password = result.find((r) => r.key === "DATAFORSEO_PASSWORD");

    expect(login?.valid).toBe(false);
    expect(password?.valid).toBe(false);
  });

  it("returns valid: false for DATAFORSEO_PASSWORD when only DATAFORSEO_LOGIN is missing", async () => {
    await ipc._invoke("credentials.save", {
      key: "DATAFORSEO_PASSWORD",
      value: "p@ssword",
    });

    global.fetch = vi.fn().mockResolvedValue({ status: 200 } as Response);

    const result = (await ipc._invoke(
      "credentials.verify",
      {},
    )) as Array<{ key: string; valid: boolean | null; error?: string }>;

    const login = result.find((r) => r.key === "DATAFORSEO_LOGIN");
    const password = result.find((r) => r.key === "DATAFORSEO_PASSWORD");

    expect(login?.valid).toBe(false);
    expect(password?.valid).toBe(false);
  });

  it("sends x-api-key and anthropic-version headers for ANTHROPIC_API_KEY verification", async () => {
    await ipc._invoke("credentials.save", {
      key: "ANTHROPIC_API_KEY",
      value: "sk-test-key",
    });

    const mockFetch = vi.fn().mockResolvedValue({ status: 200 } as Response);
    global.fetch = mockFetch;

    await ipc._invoke("credentials.verify", {});

    // Find the Anthropic API call
    const calls = mockFetch.mock.calls as [string, RequestInit][];
    const anthropicCall = calls.find(([url]) =>
      url.includes("api.anthropic.com"),
    );
    expect(anthropicCall).toBeDefined();
    const headers = anthropicCall?.[1]?.headers as Record<string, string>;
    expect(headers?.["x-api-key"]).toBe("sk-test-key");
    expect(headers?.["anthropic-version"]).toBe("2023-06-01");
  });

  it("sends Basic auth header for DATAFORSEO verification", async () => {
    await ipc._invoke("credentials.save", {
      key: "DATAFORSEO_LOGIN",
      value: "mylogin",
    });
    await ipc._invoke("credentials.save", {
      key: "DATAFORSEO_PASSWORD",
      value: "mypass",
    });

    const mockFetch = vi.fn().mockResolvedValue({ status: 200 } as Response);
    global.fetch = mockFetch;

    await ipc._invoke("credentials.verify", {});

    const calls = mockFetch.mock.calls as [string, RequestInit][];
    const dataforseoCall = calls.find(([url]) =>
      url.includes("dataforseo.com"),
    );
    expect(dataforseoCall).toBeDefined();
    const headers = dataforseoCall?.[1]?.headers as Record<string, string>;
    const expectedBasic = Buffer.from("mylogin:mypass").toString("base64");
    expect(headers?.["Authorization"]).toBe(`Basic ${expectedBasic}`);
  });

  it("throws 'timed out' error when fetch AbortError is thrown", async () => {
    // Save a credential so the fetch path is exercised for ANTHROPIC_API_KEY
    await ipc._invoke("credentials.save", {
      key: "ANTHROPIC_API_KEY",
      value: "sk-test",
    });

    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    global.fetch = vi.fn().mockRejectedValue(abortError);

    const result = (await ipc._invoke(
      "credentials.verify",
      {},
    )) as Array<{ key: string; valid: boolean | null; error?: string }>;

    const anthropic = result.find((r) => r.key === "ANTHROPIC_API_KEY");
    expect(anthropic?.valid).toBe(false);
    // The AbortError branch in fetchWithTimeout converts it to a timeout message
    expect(anthropic?.error).toContain("timed out after");
  });

  it("handles unexpected task rejection via allSettled rejected outcome", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 } as Response);

    const realAllSettled = Promise.allSettled.bind(Promise);
    try {
      // Wrap allSettled to inject one rejected outcome alongside real results
      Promise.allSettled = (<T>(promises: Iterable<T | PromiseLike<T>>) => {
        return realAllSettled(promises).then(
          (results: PromiseSettledResult<Awaited<T>>[]) => [
            ...results,
            {
              status: "rejected" as const,
              reason: new Error("injected unexpected failure"),
            },
          ],
        );
      }) as typeof Promise.allSettled;

      const result = (await ipc._invoke(
        "credentials.verify",
        {},
      )) as Array<{ key: string; valid: boolean | null; error?: string }>;

      // The "unknown" key entry produced by the rejection branch is filtered out
      // by the allowlist-ordered final pass, so the return still has exactly the
      // allowlist entries. The key assertion is that verify completes without
      // throwing — line 330 is exercised by the injected rejected outcome.
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(CREDENTIAL_ALLOWLIST.length);
    } finally {
      Promise.allSettled = realAllSettled;
    }
  });
});

// ===========================================================================
// registerCredentialMethods: verifies all three methods are registered
// ===========================================================================

describe("registerCredentialMethods", () => {
  it("registers credentials.save, credentials.list, and credentials.verify", () => {
    const registeredNames: string[] = [];
    const ipc: IpcHandler = {
      handleRequest: vi.fn() as never,
      registerMethod: vi.fn((name: string) => {
        registeredNames.push(name);
      }) as never,
      sendNotification: vi.fn() as never,
    };

    registerCredentialMethods(ipc);

    expect(registeredNames).toContain("credentials.save");
    expect(registeredNames).toContain("credentials.list");
    expect(registeredNames).toContain("credentials.verify");
  });
});
