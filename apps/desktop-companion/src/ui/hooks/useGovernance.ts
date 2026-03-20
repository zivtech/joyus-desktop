import { useCallback, useEffect, useState } from "react";

export type GovernanceMode = "strict" | "standard" | "permissive";

export interface GovernanceDecision {
  id: string;
  timestamp: string;
  action: string;
  outcome: "allow" | "deny" | "escalate";
  reason: string;
}

interface UseGovernanceResult {
  mode: GovernanceMode | undefined;
  decisions: GovernanceDecision[];
  refresh: () => void;
}

async function safeInvoke<T>(cmd: string): Promise<T | undefined> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd);
  } catch {
    return undefined;
  }
}

async function safeListen(
  event: string,
  handler: (payload: unknown) => void
): Promise<() => void> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen(event, (e) => handler(e.payload));
  } catch {
    return () => undefined;
  }
}

export function useGovernance(): UseGovernanceResult {
  const [mode, setMode] = useState<GovernanceMode | undefined>(undefined);
  const [decisions, setDecisions] = useState<GovernanceDecision[]>([]);

  const refresh = useCallback(() => {
    void safeInvoke<GovernanceMode>("get_governance_mode").then((result) => {
      if (result !== undefined) {
        setMode(result);
      }
    });
    void safeInvoke<GovernanceDecision[]>("get_governance_decisions").then((result) => {
      if (result !== undefined) {
        setDecisions(result);
      }
    });
  }, []);

  useEffect(() => {
    refresh();

    let unlistenFn: (() => void) | undefined;
    let active = true;
    void safeListen("state:governance-decision", (payload) => {
      const decision = payload as GovernanceDecision;
      setDecisions((prev) => [decision, ...prev]);
    }).then((fn) => {
      if (active) {
        unlistenFn = fn;
      } else {
        fn();
      }
    });

    return () => {
      active = false;
      unlistenFn?.();
    };
  }, [refresh]);

  return { mode, decisions, refresh };
}
