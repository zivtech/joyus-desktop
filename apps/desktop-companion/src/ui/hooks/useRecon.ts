import { useEffect, useState } from "react";

// ─── Tauri helpers ────────────────────────────────────────────────────────────

async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  } catch {
    return undefined;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface CredentialListItem {
  key: string;
  isSet: boolean;
}

interface SkillFileResult {
  found: boolean;
}

const REQUIRED_CREDENTIAL_KEYS = [
  "ANTHROPIC_API_KEY",
  "DATAFORSEO_LOGIN",
  "DATAFORSEO_PASSWORD",
  "CRUX_API_KEY",
] as const;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface ReconSetupStatus {
  setupComplete: boolean;
  missingSteps: string[];
  loading: boolean;
}

/**
 * Checks whether all Recon prerequisites are satisfied:
 *   1. All four required credential keys are set
 *   2. The joyus-recon skill file is present at ~/.claude/skills/joyus-recon.md
 *
 * TODO(WP06): Wire this hook into a route guard so unauthenticated users are
 *   redirected to /recon/setup before accessing /recon.
 */
export function useReconSetup(): ReconSetupStatus {
  const [loading, setLoading] = useState(true);
  const [missingSteps, setMissingSteps] = useState<string[]>([]);

  useEffect(() => {
    async function check() {
      const missing: string[] = [];

      // 1. Check credential keys
      const credentials = await safeInvoke<CredentialListItem[]>("credentials_list");
      if (credentials === undefined) {
        // Sidecar unavailable — treat all credentials as missing
        missing.push("credentials");
      } else {
        const setKeys = new Set(
          credentials.filter((c) => c.isSet).map((c) => c.key)
        );
        const missingKeys = REQUIRED_CREDENTIAL_KEYS.filter((k) => !setKeys.has(k));
        if (missingKeys.length > 0) {
          missing.push("credentials");
        }
      }

      // 2. Check skill file
      // TODO(WP03+): `check_skill_file` Rust command and sidecar handler
      //   (`skills.checkFile`) do not exist yet. safeInvoke returns undefined,
      //   which we treat as not-found below.
      const skillResult = await safeInvoke<SkillFileResult>("check_skill_file");
      if (skillResult === undefined || !skillResult.found) {
        missing.push("skill-file");
      }

      setMissingSteps(missing);
      setLoading(false);
    }

    void check();
  }, []);

  return {
    setupComplete: !loading && missingSteps.length === 0,
    missingSteps,
    loading,
  };
}
