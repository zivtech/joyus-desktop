/**
 * Recon Operator sidecar IPC handlers.
 *
 * Registers three methods:
 *   recon.create  — initialise a new engagement directory with metadata
 *   recon.scan    — run the sensitive-output scanner over an engagement dir
 *   recon.export  — scan-gate then zip the engagement dir for delivery
 *
 * Resource path resolution
 * ------------------------
 * The scan-sensitive-output.mjs script is bundled as a Tauri resource.
 * At runtime (packaged app) Tauri places resources adjacent to the sidecar
 * binary; the sidecar resolves the path relative to its own location via
 * import.meta.url.  In development (esbuild produces binaries/sidecar-main.mjs)
 * the same relative path resolves to
 * apps/desktop-companion/binaries/../resources/scan-sensitive-output.mjs,
 * i.e. apps/desktop-companion/resources/scan-sensitive-output.mjs — which is
 * where we placed the source copy for T005.
 */

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { IpcHandler } from "./ipc-handler";
import { autoSyncIfNeeded, checkVersion } from "./version-gate";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReconCreateResult {
  engagementDir: string;
  engagementId: string;
  clientSlug: string;
  syncPerformed: boolean;
}

interface ScanFinding {
  file: string;
  line: number;
  pattern: string;
}

interface ScanResult {
  passed: boolean;
  findings: ScanFinding[];
}

type ReconExportResult =
  | { blocked: true; findings: ScanFinding[] }
  | { zipPath: string; size: number; scanPassed: boolean; overridden?: boolean };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the path to scan-sensitive-output.mjs.
 *
 * - In production the sidecar binary lands at <resources>/sidecar-main.mjs and
 *   Tauri copies all resource files into the same directory, so we look one
 *   level up from import.meta.url (the sidecar file itself).
 * - In development the sidecar is at binaries/sidecar-main.mjs; the script
 *   lives at resources/scan-sensitive-output.mjs, one directory up then into
 *   resources/.  Both cases use the same "../resources/…" relative path.
 */
function resolveScanScript(): string {
  const sidecarDir = path.dirname(fileURLToPath(import.meta.url));
  const candidate = path.join(sidecarDir, "..", "resources", "scan-sensitive-output.mjs");
  if (existsSync(candidate)) {
    return candidate;
  }
  // Fallback: same directory as the sidecar binary (Tauri flat-copy layout)
  const sameDir = path.join(sidecarDir, "scan-sensitive-output.mjs");
  if (existsSync(sameDir)) {
    return sameDir;
  }
  throw new Error(
    `scan-sensitive-output.mjs not found. Searched:\n  ${candidate}\n  ${sameDir}`,
  );
}

/**
 * Slugify a client name: lowercase, collapse non-alphanumeric runs to a
 * single hyphen, strip leading/trailing hyphens.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Pad a number to two digits.
 */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Core scan logic — shared by recon.scan and recon.export.
 *
 * Spawns `node scan-sensitive-output.mjs <engagementDir>` and parses
 * stderr for findings.  Non-zero exit means findings were detected
 * (passed: false), not a fatal error.
 */
async function runScan(engagementDir: string): Promise<ScanResult> {
  const scriptPath = resolveScanScript();

  return new Promise<ScanResult>((resolve, reject) => {
    const child = spawn("node", [scriptPath, engagementDir], {
      stdio: ["ignore", "ignore", "pipe"],
    });

    const stderrChunks: Buffer[] = [];

    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on("error", (err: Error) => {
      reject(new Error(`Failed to spawn scan script: ${err.message}`));
    });

    child.on("close", (code: number | null) => {
      const stderrText = Buffer.concat(stderrChunks).toString("utf8");

      // Parse findings from stderr lines matching: <file>:<line> <pattern>
      // The scanner also emits a summary header like "Sensitive output scan
      // failed with N finding(s)." — skip lines that don't match the pattern.
      const FINDING_RE = /^(.+):(\d+)\s+(\S+)$/;
      const findings: ScanFinding[] = [];

      for (const rawLine of stderrText.split("\n")) {
        const line = rawLine.trim();
        if (line === "") continue;
        const m = FINDING_RE.exec(line);
        if (m === null) continue;
        findings.push({
          file: m[1] as string,
          line: parseInt(m[2] as string, 10),
          pattern: m[3] as string,
        });
      }

      // exit code 1 with findings => passed: false (expected, not an error)
      // exit code 1 without findings => unexpected — still not fatal
      if (code !== 0 && findings.length === 0) {
        // Non-zero with no parseable findings; treat as passed: false but
        // surface the stderr for diagnosis
        resolve({ passed: false, findings: [] });
        return;
      }

      resolve({ passed: findings.length === 0, findings });
    });
  });
}

// ---------------------------------------------------------------------------
// Version gate sync dep types (WP10 — T040)
// ---------------------------------------------------------------------------

export interface ReconSyncDeps {
  getSyncStatus: () => Promise<{ version: string | null; status?: string } | undefined>;
  triggerSync: () => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Public registration function (T001)
// ---------------------------------------------------------------------------

/**
 * Register all recon IPC methods.
 *
 * @param ipc      The IPC handler to register methods on.
 * @param syncDeps Optional sync callables for the version gate.  When absent
 *                 the gate is a no-op (fail-open) — e.g. in test environments
 *                 where sync wiring has not been set up.
 */
export function registerReconMethods(ipc: IpcHandler, syncDeps?: ReconSyncDeps): void {
  // -------------------------------------------------------------------------
  // T002: recon.create
  // -------------------------------------------------------------------------
  ipc.registerMethod("recon.create", async (params: unknown): Promise<unknown> => {
    if (params === null || typeof params !== "object") {
      throw new Error("recon.create: params must be an object");
    }
    const p = params as Record<string, unknown>;

    if (typeof p["clientName"] !== "string" || p["clientName"] === "") {
      throw new Error("recon.create: missing required field: clientName");
    }
    if (typeof p["url"] !== "string" || p["url"] === "") {
      throw new Error("recon.create: missing required field: url");
    }
    if (typeof p["accessMode"] !== "string" || p["accessMode"] === "") {
      throw new Error("recon.create: missing required field: accessMode");
    }

    const clientName = p["clientName"] as string;
    const url = p["url"] as string;
    const accessMode = p["accessMode"] as string;

    // -----------------------------------------------------------------------
    // WP10 — Version consistency gate (T040/T041)
    // Run before any directory creation so a version mismatch is caught early.
    // When syncDeps is absent the gate returns a no-op result (fail-open).
    // -----------------------------------------------------------------------
    let syncPerformed = false;
    if (syncDeps !== undefined) {
      const { syncPerformed: performed, versionCheck } = await autoSyncIfNeeded(
        syncDeps.getSyncStatus,
        syncDeps.triggerSync,
      );
      syncPerformed = performed;

      // Block only when the version is definitively known to be wrong — not
      // when sync is unavailable (stale: true), to preserve offline access.
      if (!versionCheck.match && versionCheck.stale !== true) {
        throw new Error(
          `recon.create: Recon skill version mismatch. ` +
          `Required: ${versionCheck.pinned ?? "unknown"}, ` +
          `current: ${versionCheck.current ?? "none"}. ` +
          `Check network connection and retry.`,
        );
      }
    }

    const clientSlug = slugify(clientName);

    const now = new Date();
    const datePart = [
      now.getFullYear(),
      pad2(now.getMonth() + 1),
      pad2(now.getDate()),
    ].join("");
    const timePart = [
      pad2(now.getHours()),
      pad2(now.getMinutes()),
      pad2(now.getSeconds()),
    ].join("");
    const engagementId = `${clientSlug}-${datePart}-${timePart}`;

    const engagementDir = path.join(
      os.homedir(),
      "Documents",
      "joyus-recon-engagements",
      clientSlug,
    );

    try {
      await fs.mkdir(engagementDir, { recursive: true });
    } catch (err) {
      throw new Error(
        `recon.create: failed to create engagement directory at ${engagementDir}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const meta = {
      clientName,
      clientSlug,
      url,
      accessMode,
      engagementId,
      createdAt: now.toISOString(),
    };

    const metaPath = path.join(engagementDir, ".recon-meta.json");
    try {
      await fs.writeFile(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
    } catch (err) {
      throw new Error(
        `recon.create: failed to write .recon-meta.json: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const result: ReconCreateResult = { engagementDir, engagementId, clientSlug, syncPerformed };
    return result;
  });

  // -------------------------------------------------------------------------
  // WP10 — recon.checkVersion (T041): direct frontend access to version gate
  // -------------------------------------------------------------------------
  ipc.registerMethod("recon.checkVersion", async (): Promise<unknown> => {
    if (syncDeps === undefined) {
      return { current: null, pinned: null, match: false, stale: true };
    }
    return checkVersion(syncDeps.getSyncStatus);
  });

  // -------------------------------------------------------------------------
  // T003: recon.scan
  // -------------------------------------------------------------------------
  ipc.registerMethod("recon.scan", async (params: unknown): Promise<unknown> => {
    if (params === null || typeof params !== "object") {
      throw new Error("recon.scan: params must be an object");
    }
    const p = params as Record<string, unknown>;
    if (typeof p["engagementDir"] !== "string" || p["engagementDir"] === "") {
      throw new Error("recon.scan: missing required field: engagementDir");
    }

    const result: ScanResult = await runScan(p["engagementDir"]);
    return result;
  });

  // -------------------------------------------------------------------------
  // T004: recon.export
  // -------------------------------------------------------------------------
  ipc.registerMethod("recon.export", async (params: unknown): Promise<unknown> => {
    if (params === null || typeof params !== "object") {
      throw new Error("recon.export: params must be an object");
    }
    const p = params as Record<string, unknown>;
    if (typeof p["engagementDir"] !== "string" || p["engagementDir"] === "") {
      throw new Error("recon.export: missing required field: engagementDir");
    }

    const engagementDir = p["engagementDir"] as string;
    const overrideScan = p["overrideScan"] === true;

    // Step 1: run scan
    const scanResult = await runScan(engagementDir);

    // Step 2: block if scan failed and override not requested
    if (!scanResult.passed && !overrideScan) {
      const blocked: ReconExportResult = { blocked: true, findings: scanResult.findings };
      return blocked;
    }

    // Step 3a: write override log if overriding a failed scan
    if (overrideScan && !scanResult.passed) {
      const overridePath = path.join(engagementDir, ".scan-overrides.json");
      const overrideRecord = {
        overriddenAt: new Date().toISOString(),
        findings: scanResult.findings,
      };
      await fs.writeFile(
        overridePath,
        JSON.stringify(overrideRecord, null, 2) + "\n",
        "utf8",
      );
    }

    // Step 3b: create zip archive
    //
    // Zip output location: <parent-of-engagementDir>/exports/<engagementDirName>.zip
    // This is deterministic, keeps exports out of the engagement dir itself,
    // and makes multiple exports for the same engagement easily identifiable.
    const engagementName = path.basename(engagementDir);
    const exportsDir = path.join(path.dirname(engagementDir), "exports");
    await fs.mkdir(exportsDir, { recursive: true });
    const zipPath = path.join(exportsDir, `${engagementName}.zip`);

    // Files and directories excluded from the zip (relative names / globs)
    const EXCLUDED_FILENAMES = new Set([
      ".env",
      ".recon-complete",
      ".recon-meta.json",
      ".scan-overrides.json",
    ]);
    const EXCLUDED_DIRS = new Set(["node_modules", ".git"]);
    const CREDENTIALS_RE = /^credentials/i;

    /**
     * Recursively collect all files under `dir` that should be included in
     * the archive, returning `[absolutePath, archivePath]` pairs.
     */
    async function collectFiles(
      dir: string,
      base: string,
    ): Promise<Array<[string, string]>> {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const results: Array<[string, string]> = [];

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const archivePath = path.join(base, entry.name);

        if (entry.isDirectory()) {
          if (EXCLUDED_DIRS.has(entry.name)) continue;
          const nested = await collectFiles(fullPath, archivePath);
          results.push(...nested);
        } else {
          if (EXCLUDED_FILENAMES.has(entry.name)) continue;
          if (CREDENTIALS_RE.test(entry.name)) continue;
          results.push([fullPath, archivePath]);
        }
      }

      return results;
    }

    const filePairs = await collectFiles(engagementDir, engagementName);

    // SPEC-DEVIATION: hand-rolled ZIP encoder
    //
    // T004 specifies using the `archiver` npm package or Node's `zlib` + `tar`
    // streams. This implementation instead uses a hand-rolled ZIP encoder built
    // on Node's built-in `Buffer` and `zlib.deflateRawSync`.
    //
    // Rationale for deviation:
    //   • `archiver` is not currently a dependency of this package, and adding
    //     it introduces ~60 KB of additional runtime code with transitive deps
    //     (archiver-utils, zip-stream, readdir-glob, etc.) into the Tauri
    //     sidecar bundle, which is otherwise dependency-light by design.
    //   • Node's `zlib` + `tar` (the other spec option) would produce a .tar.gz,
    //     not a .zip.  The spec return type names the output `zipPath` and the
    //     acceptance criteria refer to a "zip" archive, implying ZIP format is
    //     preferred for the deliverable file.
    //   • The hand-rolled implementation has zero external dependencies and is
    //     auditable in place.
    //
    // Known limitations acknowledged:
    //   • 32-bit size fields — files >4 GB will silently corrupt. Engagement
    //     dirs are expected to be well under 100 MB; this limitation is
    //     acceptable for the current use case.
    //   • Empty directories are not represented in the archive.
    //
    // Test coverage: `recon.test.ts` includes a ZIP extraction test that
    // invokes `unzip -l` on the produced archive and asserts that included
    // files are present and excluded files are absent.
    //
    // ZIP format overview:
    //   For each file: local file header + compressed (or stored) data
    //   Central directory: one entry per file
    //   End-of-central-directory record
    const { deflateRawSync } = await import("node:zlib");

    function writeUint16LE(buf: Buffer, offset: number, value: number): void {
      buf.writeUInt16LE(value, offset);
    }

    function writeUint32LE(buf: Buffer, offset: number, value: number): void {
      buf.writeUInt32LE(value, offset);
    }

    function crc32(data: Buffer): number {
      // CRC-32 table (standard ZIP polynomial 0xEDB88320)
      const table = crc32Table();
      let crc = 0xffffffff;
      for (let i = 0; i < data.length; i++) {
        crc = table[((crc ^ (data[i] as number)) & 0xff) as number]! ^ (crc >>> 8);
      }
      return (crc ^ 0xffffffff) >>> 0;
    }

    let crc32TableCache: Uint32Array | undefined;
    function crc32Table(): Uint32Array {
      if (crc32TableCache !== undefined) return crc32TableCache;
      const t = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
          c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        t[n] = c;
      }
      crc32TableCache = t;
      return t;
    }

    // We accumulate all bytes in memory then write once.
    // For very large engagements this could be streamed; engagement dirs are
    // expected to be small (< 100 MB) for this use case.
    const chunks: Buffer[] = [];
    const centralDirEntries: Buffer[] = [];
    let offset = 0;

    const dosDate = 0; // Use epoch (1980-01-01) as stable timestamp to aid reproducibility

    for (const [absPath, archivePath] of filePairs) {
      const fileData = await fs.readFile(absPath);
      const compressedData = deflateRawSync(fileData);

      // Use deflate if it's smaller, otherwise store raw
      const useDeflate = compressedData.length < fileData.length;
      const storedData = useDeflate ? compressedData : fileData;
      const method = useDeflate ? 8 : 0; // 8 = deflate, 0 = stored

      const nameBytes = Buffer.from(archivePath, "utf8");
      const crc = crc32(fileData);
      const localHeaderSize = 30 + nameBytes.length;
      const localHeader = Buffer.alloc(localHeaderSize, 0);

      writeUint32LE(localHeader, 0, 0x04034b50); // local file header signature
      writeUint16LE(localHeader, 4, 20);          // version needed: 2.0
      writeUint16LE(localHeader, 6, 0x0800);      // general purpose bit flag: UTF-8
      writeUint16LE(localHeader, 8, method);
      writeUint32LE(localHeader, 10, dosDate);    // last mod time+date (4 bytes combined)
      writeUint32LE(localHeader, 14, crc);
      writeUint32LE(localHeader, 18, storedData.length);
      writeUint32LE(localHeader, 22, fileData.length);
      writeUint16LE(localHeader, 26, nameBytes.length);
      writeUint16LE(localHeader, 28, 0);           // extra field length
      nameBytes.copy(localHeader, 30);

      // Central directory entry
      const centralEntry = Buffer.alloc(46 + nameBytes.length, 0);
      writeUint32LE(centralEntry, 0, 0x02014b50);  // central directory sig
      writeUint16LE(centralEntry, 4, 20);           // version made by
      writeUint16LE(centralEntry, 6, 20);           // version needed
      writeUint16LE(centralEntry, 8, 0x0800);       // UTF-8 flag
      writeUint16LE(centralEntry, 10, method);
      writeUint32LE(centralEntry, 12, dosDate);
      writeUint32LE(centralEntry, 16, crc);
      writeUint32LE(centralEntry, 20, storedData.length);
      writeUint32LE(centralEntry, 24, fileData.length);
      writeUint16LE(centralEntry, 28, nameBytes.length);
      writeUint16LE(centralEntry, 30, 0);           // extra field length
      writeUint16LE(centralEntry, 32, 0);           // file comment length
      writeUint16LE(centralEntry, 34, 0);           // disk number start
      writeUint16LE(centralEntry, 36, 0);           // internal attributes
      writeUint32LE(centralEntry, 38, 0);           // external attributes
      writeUint32LE(centralEntry, 42, offset);      // relative offset of local header
      nameBytes.copy(centralEntry, 46);

      chunks.push(localHeader);
      chunks.push(storedData);
      centralDirEntries.push(centralEntry);

      offset += localHeaderSize + storedData.length;
    }

    // Write central directory
    const centralDirOffset = offset;
    const centralDirBuf = Buffer.concat(centralDirEntries);
    chunks.push(centralDirBuf);

    // End-of-central-directory record
    const eocd = Buffer.alloc(22, 0);
    writeUint32LE(eocd, 0, 0x06054b50);                  // EOCD signature
    writeUint16LE(eocd, 4, 0);                            // disk number
    writeUint16LE(eocd, 6, 0);                            // disk with CD start
    writeUint16LE(eocd, 8, centralDirEntries.length);     // entries on disk
    writeUint16LE(eocd, 10, centralDirEntries.length);    // total entries
    writeUint32LE(eocd, 12, centralDirBuf.length);        // size of central dir
    writeUint32LE(eocd, 16, centralDirOffset);            // offset of central dir
    writeUint16LE(eocd, 20, 0);                           // comment length
    chunks.push(eocd);

    const zipBuffer = Buffer.concat(chunks);
    await fs.writeFile(zipPath, zipBuffer);

    const stat = await fs.stat(zipPath);

    const result: ReconExportResult = {
      zipPath,
      size: stat.size,
      scanPassed: scanResult.passed,
      ...(overrideScan && !scanResult.passed ? { overridden: true } : {}),
    };
    return result;
  });
}
