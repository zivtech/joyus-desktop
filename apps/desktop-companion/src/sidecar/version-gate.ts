/**
 * Version Consistency Gate (WP10 — T040/T041)
 *
 * Checks that the deployed recon-operator-bundle version matches the version
 * pinned in distribution-config.json.  If it does not, an auto-sync is
 * attempted before a recon engagement is allowed to start.
 *
 * IpcHandler does not expose a callMethod helper, so sync operations are
 * threaded as plain async callables injected by the caller.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const BUNDLE_NAME = "recon-operator-bundle";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VersionCheckResult {
  current: string | null;
  pinned: string | null;
  match: boolean;
  /** true when current version could not be determined (sync unavailable) */
  stale?: boolean;
}

// ---------------------------------------------------------------------------
// Distribution config resolution
// ---------------------------------------------------------------------------

/**
 * Resolve path candidates for distribution-config.json.
 *
 * The sidecar binary may land in different directories depending on context:
 *  - Dev build (esbuild):  <root>/apps/desktop-companion/binaries/sidecar-main.mjs
 *    → need 3 levels up from binaries/ to reach repo root
 *  - Source (TypeScript):  <root>/apps/desktop-companion/src/sidecar/version-gate.ts
 *    → need 4 levels up from src/sidecar/ to reach repo root
 *  - Production (Tauri):   resources are flat-copied next to the sidecar binary
 *    → config may be in the same dir or one level up
 *
 * We try all plausible locations and return the first that parses correctly.
 */
function resolveDistributionConfigCandidates(): string[] {
  const sidecarDir = path.dirname(fileURLToPath(import.meta.url));
  return [
    // Dev build: binaries/ → 3 up to repo root
    path.join(sidecarDir, "..", "..", "..", "config", "distribution-config.json"),
    // Source tree: src/sidecar/ → 4 up to repo root
    path.join(sidecarDir, "..", "..", "..", "..", "config", "distribution-config.json"),
    // Production flat resource layout — config bundled one level up
    path.join(sidecarDir, "..", "config", "distribution-config.json"),
    // Production flat resource layout — config bundled in same directory
    path.join(sidecarDir, "distribution-config.json"),
  ];
}

async function readPinnedVersion(): Promise<string | null> {
  const candidates = resolveDistributionConfigCandidates();

  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate, "utf8");
      const config = JSON.parse(raw) as {
        bundles?: Record<string, { version?: string }>;
      };
      const version = config?.bundles?.[BUNDLE_NAME]?.version ?? null;
      if (version !== null) {
        return version;
      }
    } catch {
      // File not found or not parseable at this candidate — try next
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether the currently deployed bundle version matches the pinned
 * version from distribution-config.json.
 *
 * @param getSyncStatus  Callable that resolves sync.status — returns the
 *                       current sync state including `version`.
 */
export async function checkVersion(
  getSyncStatus: () => Promise<{ version: string | null; status?: string } | undefined>,
): Promise<VersionCheckResult> {
  const pinned = await readPinnedVersion();

  let current: string | null = null;
  try {
    const statusResult = await getSyncStatus();
    current = statusResult?.version ?? null;
  } catch {
    current = null;
  }

  if (current === null) {
    return { current: null, pinned, match: false, stale: true };
  }

  return {
    current,
    pinned,
    match: current === pinned,
  };
}

/**
 * If the current bundle version does not match the pinned version, trigger a
 * sync and re-check.  Returns whether a sync was performed and the final
 * version check result.
 *
 * On sync failure the result is returned with `stale: true` — callers decide
 * whether to block on staleness.
 *
 * @param getSyncStatus  Callable that resolves sync.status.
 * @param triggerSync    Callable that triggers a sync and waits for completion.
 */
export async function autoSyncIfNeeded(
  getSyncStatus: () => Promise<{ version: string | null; status?: string } | undefined>,
  triggerSync: () => Promise<unknown>,
): Promise<{ syncPerformed: boolean; versionCheck: VersionCheckResult }> {
  const initial = await checkVersion(getSyncStatus);

  if (initial.match) {
    return { syncPerformed: false, versionCheck: initial };
  }

  // Attempt sync — treat errors as stale (fail-open so offline users are
  // not blocked from creating engagements)
  try {
    await triggerSync();
  } catch {
    return {
      syncPerformed: true,
      versionCheck: { ...initial, stale: true },
    };
  }

  // Re-check post-sync
  const postSync = await checkVersion(getSyncStatus);
  return { syncPerformed: true, versionCheck: postSync };
}
