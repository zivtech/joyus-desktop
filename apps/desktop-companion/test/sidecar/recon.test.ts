/**
 * Unit tests for apps/desktop-companion/src/sidecar/recon.ts
 *
 * Strategy:
 * - `node:child_process` spawn is mocked at the module boundary so tests do
 *   not depend on the scan script being present at a particular path.
 * - `existsSync` from `node:fs` is mocked to return `true` so
 *   `resolveScanScript()` always finds a "candidate" path without touching
 *   the real filesystem.
 * - `node:fs/promises` calls are real: recon.create / recon.export use a
 *   real temp directory that is cleaned up after each test.
 * - `execSync` from `node:child_process` is kept real (via importOriginal)
 *   so the ZIP extraction test can invoke `unzip -l` against the actual
 *   archive produced by recon.export.
 */

import {
  describe,
  expect,
  it,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, existsSync as realExistsSync } from "node:fs";
import { readFile, writeFile, mkdir, writeFile as realWriteFile } from "node:fs/promises";
import { promises as mockedFsPromises } from "node:fs";
import { execSync } from "node:child_process";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

// Mock existsSync so that resolveScanScript() always returns a valid-looking
// path (the first candidate), without requiring the script to be on disk.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
  };
});

// Mock spawn so tests never exec real child processes.
// execSync is preserved via importOriginal so the ZIP extraction test works.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Mock version-gate so tests can control autoSyncIfNeeded / checkVersion
// without real filesystem access (readPinnedVersion reads distribution-config.json).
// ---------------------------------------------------------------------------

const vgMock = vi.hoisted(() => ({
  autoSyncIfNeeded: vi.fn(),
  checkVersion: vi.fn(),
}));

vi.mock("../../src/sidecar/version-gate", () => vgMock);

// ---------------------------------------------------------------------------
// Import production code AFTER mocks are declared
// ---------------------------------------------------------------------------

import { registerReconMethods } from "../../src/sidecar/recon";
import type { IpcHandler, MethodHandler } from "../../src/sidecar/ipc-handler";

// ---------------------------------------------------------------------------
// IPC test harness
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
// Spawn mock helper
//
// Creates a fake child process object that mirrors EventEmitter + stderr stream.
// Call `emitStderr(text)` and `emitClose(code)` to drive the production code's
// event listeners.
// ---------------------------------------------------------------------------

type FakeChild = EventEmitter & {
  stderr: EventEmitter;
  emitStderr: (text: string) => void;
  emitClose: (code: number) => void;
};

function makeFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stderr = new EventEmitter();

  child.emitStderr = (text: string): void => {
    child.stderr.emit("data", Buffer.from(text, "utf8"));
  };

  child.emitClose = (code: number): void => {
    child.emit("close", code);
  };

  return child;
}

// ---------------------------------------------------------------------------
// Temporary directory helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "recon-test-"));
}

function removeTempDir(dir: string): void {
  if (realExistsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// spawn import — used to configure mock return values
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type SpawnFn = typeof import("node:child_process").spawn;

async function getSpawnMock(): Promise<MockInstance> {
  const mod = await import("node:child_process");
  return mod.spawn as unknown as MockInstance;
}

// ---------------------------------------------------------------------------
// Helper: set up spawn to return a "clean" result (no findings)
// ---------------------------------------------------------------------------

async function spawnReturnsClean(): Promise<FakeChild> {
  const spawnMock = await getSpawnMock();
  const fakeChild = makeFakeChild();
  spawnMock.mockReturnValueOnce(fakeChild as unknown as ReturnType<SpawnFn>);
  return fakeChild;
}

// ---------------------------------------------------------------------------
// Helper: set up spawn to return one finding
// ---------------------------------------------------------------------------

async function spawnReturnsFinding(
  file: string,
  line: number,
  pattern: string,
): Promise<FakeChild> {
  const spawnMock = await getSpawnMock();
  const fakeChild = makeFakeChild();
  spawnMock.mockReturnValueOnce(fakeChild as unknown as ReturnType<SpawnFn>);

  // Emit after a tick so callers can queue the promise first
  setImmediate(() => {
    fakeChild.emitStderr(
      `Sensitive output scan failed with 1 finding(s).\n${file}:${line} ${pattern}\n`,
    );
    fakeChild.emitClose(1);
  });

  return fakeChild;
}

// ---------------------------------------------------------------------------
// Helper: drive a clean spawn (no stderr, exit 0)
// ---------------------------------------------------------------------------

function resolveCleanChild(fakeChild: FakeChild): void {
  setImmediate(() => {
    fakeChild.emitClose(0);
  });
}

// ===========================================================================
// T1: slugify — tested indirectly through recon.create's returned clientSlug
// ===========================================================================

describe("slugify (via recon.create)", () => {
  let ipc: InvokableMockIpc;
  let tempDir: string;

  beforeEach(() => {
    ipc = makeIpc();
    registerReconMethods(ipc);
    // recon.create writes to ~/Documents/joyus-recon-engagements — redirect to a
    // temp dir by monkey-patching os.homedir isn't viable in ESM.
    // Instead we accept that these tests write to a real temp path and we will
    // point engagementDir to a known subdir.  We capture the returned
    // engagementDir and clean it up afterward.
    tempDir = "";
  });

  afterEach(() => {
    if (tempDir !== "" && realExistsSync(tempDir)) {
      removeTempDir(tempDir);
    }
  });

  it("slugifies simple spaces to hyphens", async () => {
    const result = (await ipc._invoke("recon.create", {
      clientName: "Acme Corp",
      url: "https://acme.example.com",
      accessMode: "rfp",
    })) as { clientSlug: string; engagementDir: string };
    tempDir = path.dirname(result.engagementDir); // parent is clientSlug dir
    expect(result.clientSlug).toBe("acme-corp");
    removeTempDir(result.engagementDir);
  });

  it("slugifies special characters to single hyphens", async () => {
    const result = (await ipc._invoke("recon.create", {
      clientName: "Müller & Sons: Inc.",
      url: "https://muller.example.com",
      accessMode: "rfp",
    })) as { clientSlug: string; engagementDir: string };
    tempDir = result.engagementDir;
    // ü -> collapse non-ascii + spaces + & + : + . all to hyphens -> "m-ller-sons-inc"
    expect(result.clientSlug).toBe("m-ller-sons-inc");
    removeTempDir(result.engagementDir);
  });

  it("strips leading and trailing hyphens", async () => {
    const result = (await ipc._invoke("recon.create", {
      clientName: "---Test---",
      url: "https://test.example.com",
      accessMode: "rfp",
    })) as { clientSlug: string; engagementDir: string };
    tempDir = result.engagementDir;
    expect(result.clientSlug).toBe("test");
    removeTempDir(result.engagementDir);
  });

  it("collapses multiple non-alphanumeric runs to a single hyphen", async () => {
    const result = (await ipc._invoke("recon.create", {
      clientName: "A  B   C",
      url: "https://abc.example.com",
      accessMode: "rfp",
    })) as { clientSlug: string; engagementDir: string };
    tempDir = result.engagementDir;
    expect(result.clientSlug).toBe("a-b-c");
    removeTempDir(result.engagementDir);
  });
});

// ===========================================================================
// T2: recon.create — happy path and validation
// ===========================================================================

describe("recon.create", () => {
  let ipc: InvokableMockIpc;

  beforeEach(() => {
    ipc = makeIpc();
    registerReconMethods(ipc);
  });

  it("happy path: creates directory and writes .recon-meta.json", async () => {
    const result = (await ipc._invoke("recon.create", {
      clientName: "Happy Path Co",
      url: "https://happypath.example.com",
      accessMode: "full",
    })) as {
      engagementDir: string;
      engagementId: string;
      clientSlug: string;
    };

    try {
      expect(result.clientSlug).toBe("happy-path-co");
      expect(typeof result.engagementId).toBe("string");
      expect(result.engagementId.startsWith("happy-path-co-")).toBe(true);
      expect(typeof result.engagementDir).toBe("string");

      // Directory must exist
      expect(realExistsSync(result.engagementDir)).toBe(true);

      // .recon-meta.json must exist and have correct fields
      const metaPath = path.join(result.engagementDir, ".recon-meta.json");
      expect(realExistsSync(metaPath)).toBe(true);

      const meta = JSON.parse(await readFile(metaPath, "utf8")) as Record<string, unknown>;
      expect(meta["clientName"]).toBe("Happy Path Co");
      expect(meta["clientSlug"]).toBe("happy-path-co");
      expect(meta["url"]).toBe("https://happypath.example.com");
      expect(meta["accessMode"]).toBe("full");
      expect(typeof meta["engagementId"]).toBe("string");
      expect(typeof meta["createdAt"]).toBe("string");
      // createdAt should be a parseable ISO-8601 string
      expect(Number.isNaN(new Date(meta["createdAt"] as string).getTime())).toBe(false);
    } finally {
      removeTempDir(result.engagementDir);
    }
  });

  it("rejects null params", async () => {
    await expect(ipc._invoke("recon.create", null)).rejects.toThrow(
      "params must be an object",
    );
  });

  it("rejects missing clientName", async () => {
    await expect(
      ipc._invoke("recon.create", {
        url: "https://example.com",
        accessMode: "rfp",
      }),
    ).rejects.toThrow("missing required field: clientName");
  });

  it("rejects empty clientName", async () => {
    await expect(
      ipc._invoke("recon.create", {
        clientName: "",
        url: "https://example.com",
        accessMode: "rfp",
      }),
    ).rejects.toThrow("missing required field: clientName");
  });

  it("rejects missing url", async () => {
    await expect(
      ipc._invoke("recon.create", {
        clientName: "Acme",
        accessMode: "rfp",
      }),
    ).rejects.toThrow("missing required field: url");
  });

  it("rejects missing accessMode", async () => {
    await expect(
      ipc._invoke("recon.create", {
        clientName: "Acme",
        url: "https://acme.example.com",
      }),
    ).rejects.toThrow("missing required field: accessMode");
  });
});

// ===========================================================================
// resolveScanScript fallback and throw paths
// ===========================================================================

describe("resolveScanScript", () => {
  let ipc: InvokableMockIpc;
  const existsSyncMock = vi.mocked(realExistsSync);

  beforeEach(() => {
    ipc = makeIpc();
    registerReconMethods(ipc);
  });

  afterEach(() => {
    existsSyncMock.mockReturnValue(true);
  });

  it("uses fallback path when primary candidate does not exist", async () => {
    const spawnMock = await getSpawnMock();
    const fakeChild = makeFakeChild();
    spawnMock.mockReturnValueOnce(fakeChild as unknown as ReturnType<SpawnFn>);

    // First existsSync (primary candidate) → false, second (fallback) → true
    existsSyncMock.mockReturnValueOnce(false).mockReturnValueOnce(true);

    const promise = ipc._invoke("recon.scan", { engagementDir: "/tmp/fake-engagement" });
    resolveCleanChild(fakeChild);
    const result = (await promise) as { passed: boolean };

    expect(result.passed).toBe(true);
    expect(spawnMock).toHaveBeenCalled();
  });

  it("throws when neither scan script candidate exists", async () => {
    existsSyncMock.mockReturnValueOnce(false).mockReturnValueOnce(false);

    await expect(
      ipc._invoke("recon.scan", { engagementDir: "/tmp/fake-engagement" }),
    ).rejects.toThrow("scan-sensitive-output.mjs not found");
  });
});

// ===========================================================================
// T3: recon.scan
// ===========================================================================

describe("recon.scan", () => {
  let ipc: InvokableMockIpc;

  beforeEach(() => {
    ipc = makeIpc();
    registerReconMethods(ipc);
  });

  it("rejects null params", async () => {
    await expect(ipc._invoke("recon.scan", null)).rejects.toThrow(
      "params must be an object",
    );
  });

  it("rejects missing engagementDir", async () => {
    await expect(ipc._invoke("recon.scan", {})).rejects.toThrow(
      "missing required field: engagementDir",
    );
  });

  it("returns passed: true and empty findings on a clean engagement dir", async () => {
    const spawnMock = await getSpawnMock();
    const fakeChild = makeFakeChild();
    spawnMock.mockReturnValueOnce(fakeChild as unknown as ReturnType<SpawnFn>);

    const scanPromise = ipc._invoke("recon.scan", {
      engagementDir: "/tmp/clean-engagement",
    });

    // Drive the mock process: no stderr output, exit 0
    resolveCleanChild(fakeChild);

    const result = (await scanPromise) as {
      passed: boolean;
      findings: Array<{ file: string; line: number; pattern: string }>;
    };

    expect(result.passed).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it("returns passed: false with findings when scan detects a credential string", async () => {
    const engDir = "/tmp/test-cred-engagement";
    const credFile = `${engDir}/output.json`;
    const spawnMock = await getSpawnMock();
    const fakeChild = makeFakeChild();
    spawnMock.mockReturnValueOnce(fakeChild as unknown as ReturnType<SpawnFn>);

    const scanPromise = ipc._invoke("recon.scan", { engagementDir: engDir });

    // Simulate scanner detecting a labeled-secret finding
    setImmediate(() => {
      fakeChild.emitStderr(
        `Sensitive output scan failed with 1 finding(s).\n` +
        `${credFile}:3 labeled-secret\n`,
      );
      fakeChild.emitClose(1);
    });

    const result = (await scanPromise) as {
      passed: boolean;
      findings: Array<{ file: string; line: number; pattern: string }>;
    };

    expect(result.passed).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toEqual({
      file: credFile,
      line: 3,
      pattern: "labeled-secret",
    });
  });

  it("returns passed: false with empty findings on non-zero exit with no parseable stderr", async () => {
    const spawnMock = await getSpawnMock();
    const fakeChild = makeFakeChild();
    spawnMock.mockReturnValueOnce(fakeChild as unknown as ReturnType<SpawnFn>);

    const scanPromise = ipc._invoke("recon.scan", {
      engagementDir: "/tmp/broken-engagement",
    });

    setImmediate(() => {
      fakeChild.emitStderr("Error: permission denied\n");
      fakeChild.emitClose(1);
    });

    const result = (await scanPromise) as { passed: boolean; findings: unknown[] };
    // Non-zero with no matching findings lines -> passed: false, no structured findings
    expect(result.passed).toBe(false);
    expect(result.findings).toHaveLength(0);
  });

  it("rejects when spawn emits an error event", async () => {
    const spawnMock = await getSpawnMock();
    const fakeChild = makeFakeChild();
    spawnMock.mockReturnValueOnce(fakeChild as unknown as ReturnType<SpawnFn>);

    const scanPromise = ipc._invoke("recon.scan", {
      engagementDir: "/tmp/error-engagement",
    });

    setImmediate(() => {
      fakeChild.emit("error", new Error("ENOENT: node not found"));
    });

    await expect(scanPromise).rejects.toThrow("Failed to spawn scan script");
  });
});

// ===========================================================================
// T4: recon.export — scan gate, override path, ZIP production
// ===========================================================================

describe("recon.export", () => {
  let ipc: InvokableMockIpc;
  let engagementDir: string;
  let spawnMock: MockInstance;

  beforeEach(async () => {
    ipc = makeIpc();
    registerReconMethods(ipc);
    engagementDir = makeTempDir();
    spawnMock = await getSpawnMock();
  });

  afterEach(() => {
    removeTempDir(engagementDir);
    // Also clean up the exports dir that recon.export creates adjacent to engDir
    const exportsDir = path.join(path.dirname(engagementDir), "exports");
    if (realExistsSync(exportsDir)) {
      removeTempDir(exportsDir);
    }
  });

  it("rejects null params", async () => {
    await expect(ipc._invoke("recon.export", null)).rejects.toThrow(
      "params must be an object",
    );
  });

  it("rejects missing engagementDir", async () => {
    await expect(ipc._invoke("recon.export", {})).rejects.toThrow(
      "missing required field: engagementDir",
    );
  });

  it("returns blocked: true when scan fails and overrideScan is falsy", async () => {
    const fakeChild = makeFakeChild();
    spawnMock.mockReturnValueOnce(fakeChild as unknown as ReturnType<SpawnFn>);

    const credFile = path.join(engagementDir, "output.json");
    const exportPromise = ipc._invoke("recon.export", { engagementDir });

    setImmediate(() => {
      fakeChild.emitStderr(
        `Sensitive output scan failed with 1 finding(s).\n` +
        `${credFile}:1 labeled-secret\n`,
      );
      fakeChild.emitClose(1);
    });

    const result = (await exportPromise) as {
      blocked: boolean;
      findings: Array<{ file: string; line: number; pattern: string }>;
    };

    expect(result.blocked).toBe(true);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.pattern).toBe("labeled-secret");
  });

  it("writes .scan-overrides.json and returns overridden: true when overrideScan is true and scan failed", async () => {
    const fakeChild = makeFakeChild();
    spawnMock.mockReturnValueOnce(fakeChild as unknown as ReturnType<SpawnFn>);

    const credFile = path.join(engagementDir, "output.json");
    const exportPromise = ipc._invoke("recon.export", {
      engagementDir,
      overrideScan: true,
    });

    setImmediate(() => {
      fakeChild.emitStderr(
        `Sensitive output scan failed with 1 finding(s).\n` +
        `${credFile}:1 labeled-secret\n`,
      );
      fakeChild.emitClose(1);
    });

    const result = (await exportPromise) as {
      zipPath: string;
      size: number;
      scanPassed: boolean;
      overridden?: boolean;
    };

    expect(result.overridden).toBe(true);
    expect(result.scanPassed).toBe(false);

    // .scan-overrides.json must be written to the engagement directory
    const overridePath = path.join(engagementDir, ".scan-overrides.json");
    expect(realExistsSync(overridePath)).toBe(true);
    const overrideData = JSON.parse(await readFile(overridePath, "utf8")) as {
      overriddenAt: string;
      findings: Array<{ file: string; line: number; pattern: string }>;
    };
    expect(typeof overrideData.overriddenAt).toBe("string");
    expect(overrideData.findings).toHaveLength(1);
  });

  it("returns correct shape on a clean scan export", async () => {
    // Write a real file to the engagement dir so the ZIP is non-empty
    await writeFile(path.join(engagementDir, "notes.txt"), "recon notes here");

    const fakeChild = makeFakeChild();
    spawnMock.mockReturnValueOnce(fakeChild as unknown as ReturnType<SpawnFn>);

    const exportPromise = ipc._invoke("recon.export", { engagementDir });
    resolveCleanChild(fakeChild);

    const result = (await exportPromise) as {
      zipPath: string;
      size: number;
      scanPassed: boolean;
      overridden?: boolean;
    };

    expect(result.scanPassed).toBe(true);
    expect(result.overridden).toBeUndefined();
    expect(typeof result.zipPath).toBe("string");
    expect(result.zipPath.endsWith(".zip")).toBe(true);
    expect(typeof result.size).toBe("number");
    expect(result.size).toBeGreaterThan(0);
  });

  it("excludes sensitive files from the ZIP archive", async () => {
    // Write files — some should be excluded
    await writeFile(path.join(engagementDir, "notes.txt"), "safe content");
    await writeFile(path.join(engagementDir, ".env"), "SECRET=hunter2");
    await writeFile(path.join(engagementDir, ".recon-meta.json"), "{}");
    await writeFile(path.join(engagementDir, "credentials.json"), "{}");
    await writeFile(path.join(engagementDir, ".recon-complete"), "done");
    await writeFile(path.join(engagementDir, ".scan-overrides.json"), "{}");
    // A subdirectory that should be excluded
    await mkdir(path.join(engagementDir, "node_modules"), { recursive: true });
    await writeFile(path.join(engagementDir, "node_modules", "pkg.json"), "{}");

    const fakeChild = makeFakeChild();
    spawnMock.mockReturnValueOnce(fakeChild as unknown as ReturnType<SpawnFn>);

    const exportPromise = ipc._invoke("recon.export", { engagementDir });
    resolveCleanChild(fakeChild);

    const result = (await exportPromise) as { zipPath: string; size: number };

    expect(realExistsSync(result.zipPath)).toBe(true);

    // Use the system `unzip -l` to list archive contents and verify exclusions
    let unzipOutput: string;
    try {
      unzipOutput = execSync(`unzip -l "${result.zipPath}"`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      // If unzip is not available, skip this assertion
      const isUnavailable =
        err instanceof Error &&
        (err.message.includes("ENOENT") || err.message.includes("not found"));
      if (isUnavailable) return;
      throw err;
    }

    // Included file
    expect(unzipOutput).toContain("notes.txt");

    // Excluded files must NOT appear
    const EXCLUDED = [
      ".env",
      ".recon-meta.json",
      ".scan-overrides.json",
      ".recon-complete",
      "credentials.json",
      "node_modules",
    ];
    for (const excluded of EXCLUDED) {
      expect(unzipOutput).not.toContain(excluded);
    }
  });

  it("includes files in nested subdirectories in the ZIP archive", async () => {
    // Create a subdirectory with a file inside the engagement dir
    const subDir = path.join(engagementDir, "reports");
    await mkdir(subDir, { recursive: true });
    await writeFile(path.join(subDir, "summary.txt"), "report content");
    await writeFile(path.join(engagementDir, "notes.txt"), "top-level note");

    const fakeChild = makeFakeChild();
    spawnMock.mockReturnValueOnce(fakeChild as unknown as ReturnType<SpawnFn>);

    const exportPromise = ipc._invoke("recon.export", { engagementDir });
    resolveCleanChild(fakeChild);

    const result = (await exportPromise) as { zipPath: string; size: number };

    expect(realExistsSync(result.zipPath)).toBe(true);

    // Use the system `unzip -l` to verify the nested file is in the archive
    let unzipOutput: string;
    try {
      unzipOutput = execSync(`unzip -l "${result.zipPath}"`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      const isUnavailable =
        err instanceof Error &&
        (err.message.includes("ENOENT") || err.message.includes("not found"));
      if (isUnavailable) return;
      throw err;
    }

    expect(unzipOutput).toContain("notes.txt");
    expect(unzipOutput).toContain("summary.txt");
  });
});

// ===========================================================================
// T5: recon.checkVersion — version gate IPC method
// ===========================================================================

describe("recon.checkVersion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns stale result when syncDeps is not provided", async () => {
    const ipc = makeIpc();
    // Register without syncDeps — version gate is a no-op
    registerReconMethods(ipc);

    const result = (await ipc._invoke("recon.checkVersion", {})) as {
      current: string | null;
      pinned: string | null;
      match: boolean;
      stale: boolean;
    };

    expect(result.current).toBeNull();
    expect(result.pinned).toBeNull();
    expect(result.match).toBe(false);
    expect(result.stale).toBe(true);
  });

  it("delegates to checkVersion from version-gate when syncDeps is provided", async () => {
    const ipc = makeIpc();
    const getSyncStatus = vi.fn().mockResolvedValue({ version: "1.2.3" });
    const triggerSync = vi.fn().mockResolvedValue(undefined);

    const expectedResult = {
      current: "1.2.3",
      pinned: "1.2.3",
      match: true,
    };
    vgMock.checkVersion.mockResolvedValue(expectedResult);

    registerReconMethods(ipc, { getSyncStatus, triggerSync });

    const result = await ipc._invoke("recon.checkVersion", {});

    expect(vgMock.checkVersion).toHaveBeenCalledWith(getSyncStatus);
    expect(result).toEqual(expectedResult);
  });
});

// ===========================================================================
// T6: recon.create — version gate integration (syncDeps provided)
// ===========================================================================

describe("recon.create with syncDeps (version gate)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks creation when version is definitively mismatched (stale: false)", async () => {
    const ipc = makeIpc();
    const getSyncStatus = vi.fn().mockResolvedValue({ version: "1.0.0" });
    const triggerSync = vi.fn().mockResolvedValue(undefined);

    // autoSyncIfNeeded returns a definitive mismatch (stale NOT true)
    vgMock.autoSyncIfNeeded.mockResolvedValue({
      syncPerformed: true,
      versionCheck: { current: "1.0.0", pinned: "2.0.0", match: false },
    });

    registerReconMethods(ipc, { getSyncStatus, triggerSync });

    await expect(
      ipc._invoke("recon.create", {
        clientName: "Version Mismatch Co",
        url: "https://example.com",
        accessMode: "rfp",
      }),
    ).rejects.toThrow("recon.create: Recon skill version mismatch");
  });

  it("allows creation when version matches (fail-open: match=true)", async () => {
    const ipc = makeIpc();
    const getSyncStatus = vi.fn().mockResolvedValue({ version: "2.0.0" });
    const triggerSync = vi.fn().mockResolvedValue(undefined);

    // autoSyncIfNeeded returns a successful match
    vgMock.autoSyncIfNeeded.mockResolvedValue({
      syncPerformed: false,
      versionCheck: { current: "2.0.0", pinned: "2.0.0", match: true },
    });

    registerReconMethods(ipc, { getSyncStatus, triggerSync });

    let result: { engagementDir: string } | undefined;
    try {
      result = (await ipc._invoke("recon.create", {
        clientName: "Version Match Co",
        url: "https://example.com",
        accessMode: "rfp",
      })) as { engagementDir: string };

      expect(typeof result.engagementDir).toBe("string");
    } finally {
      if (result?.engagementDir !== undefined && realExistsSync(result.engagementDir)) {
        removeTempDir(result.engagementDir);
      }
    }
  });

  it("allows creation when version is stale (fail-open: stale=true)", async () => {
    const ipc = makeIpc();
    const getSyncStatus = vi.fn().mockResolvedValue(undefined);
    const triggerSync = vi.fn().mockResolvedValue(undefined);

    // autoSyncIfNeeded returns stale — offline scenario, fail-open
    vgMock.autoSyncIfNeeded.mockResolvedValue({
      syncPerformed: false,
      versionCheck: { current: null, pinned: "2.0.0", match: false, stale: true },
    });

    registerReconMethods(ipc, { getSyncStatus, triggerSync });

    let result: { engagementDir: string } | undefined;
    try {
      result = (await ipc._invoke("recon.create", {
        clientName: "Stale Version Co",
        url: "https://example.com",
        accessMode: "rfp",
      })) as { engagementDir: string };

      expect(typeof result.engagementDir).toBe("string");
    } finally {
      if (result?.engagementDir !== undefined && realExistsSync(result.engagementDir)) {
        removeTempDir(result.engagementDir);
      }
    }
  });

  it("wraps mkdir errors with a descriptive message", async () => {
    const ipc = makeIpc();
    registerReconMethods(ipc);

    const mkdirSpy = vi.spyOn(mockedFsPromises, "mkdir")
      .mockRejectedValueOnce(new Error("EACCES: permission denied"));

    await expect(
      ipc._invoke("recon.create", {
        clientName: "Mkdir Fail Co",
        url: "https://example.com",
        accessMode: "rfp",
      }),
    ).rejects.toThrow("recon.create: failed to create engagement directory");

    mkdirSpy.mockRestore();
  });

  it("wraps writeFile errors with a descriptive message", async () => {
    const ipc = makeIpc();
    registerReconMethods(ipc);

    // mkdir succeeds, writeFile fails
    const mkdirSpy = vi.spyOn(mockedFsPromises, "mkdir").mockResolvedValueOnce(undefined);
    const writeSpy = vi.spyOn(mockedFsPromises, "writeFile")
      .mockRejectedValueOnce(new Error("ENOSPC: no space left on device"));

    await expect(
      ipc._invoke("recon.create", {
        clientName: "Write Fail Co",
        url: "https://example.com",
        accessMode: "rfp",
      }),
    ).rejects.toThrow("recon.create: failed to write .recon-meta.json");

    mkdirSpy.mockRestore();
    writeSpy.mockRestore();
  });
});
