import { useEffect, useState } from "react";

// ─── Tauri helpers ────────────────────────────────────────────────────────────

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T | undefined>;

interface UseReconSetupDeps {
  readonly invoke?: InvokeFn;
}

async function defaultInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(cmd, args);
  } catch {
    return undefined;
  }
}

async function safeInvoke<T>(
  invokeFn: InvokeFn,
  cmd: string,
  args?: Record<string, unknown>
): Promise<T | undefined> {
  try {
    return await invokeFn<T>(cmd, args);
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
  "DATAFORSEO_USERNAME",
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
export function useReconSetup(deps: UseReconSetupDeps = {}): ReconSetupStatus {
  const invokeFn = deps.invoke ?? defaultInvoke;
  const [loading, setLoading] = useState(true);
  const [missingSteps, setMissingSteps] = useState<string[]>([]);

  useEffect(() => {
    async function check() {
      const missing: string[] = [];

      // 1. Check credential keys
      const credentials = await safeInvoke<CredentialListItem[]>(invokeFn, "credentials_list");
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
      const skillResult = await safeInvoke<SkillFileResult>(invokeFn, "check_skill_file");
      if (skillResult === undefined || !skillResult.found) {
        missing.push("skill-file");
      }

      setMissingSteps(missing);
      setLoading(false);
    }

    void check();
  }, [invokeFn]);

  return {
    setupComplete: !loading && missingSteps.length === 0,
    missingSteps,
    loading,
  };
}
