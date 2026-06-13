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

type InvokeFn = <T>(cmd: string) => Promise<T | undefined>;
type ListenFn = (
  event: string,
  handler: (payload: unknown) => void
) => Promise<() => void>;

interface UseGovernanceDeps {
  readonly invoke?: InvokeFn;
  readonly listen?: ListenFn;
}

async function defaultInvoke<T>(cmd: string): Promise<T | undefined> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(cmd);
  } catch {
    return undefined;
  }
}

async function defaultListen(
  event: string,
  handler: (payload: unknown) => void
): Promise<() => void> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen(event, (e) => handler(e.payload));
  } catch {
    return () => undefined;
  }
}

async function safeInvoke<T>(invokeFn: InvokeFn, cmd: string): Promise<T | undefined> {
  try {
    return await invokeFn<T>(cmd);
  } catch {
    return undefined;
  }
}

async function safeListen(
  listenFn: ListenFn,
  event: string,
  handler: (payload: unknown) => void
): Promise<() => void> {
  try {
    return await listenFn(event, handler);
  } catch {
    return () => undefined;
  }
}

export function useGovernance(deps: UseGovernanceDeps = {}): UseGovernanceResult {
  const invokeFn = deps.invoke ?? defaultInvoke;
  const listenFn = deps.listen ?? defaultListen;
  const [mode, setMode] = useState<GovernanceMode | undefined>(undefined);
  const [decisions, setDecisions] = useState<GovernanceDecision[]>([]);

  const refresh = useCallback(() => {
    void safeInvoke<GovernanceMode>(invokeFn, "get_governance_mode").then((result) => {
      if (result !== undefined) {
        setMode(result);
      }
    });
    void safeInvoke<GovernanceDecision[]>(invokeFn, "get_governance_decisions").then((result) => {
      if (result !== undefined) {
        setDecisions(result);
      }
    });
  }, [invokeFn]);

  useEffect(() => {
    refresh();

    let unlistenFn: (() => void) | undefined;
    let active = true;
    void safeListen(listenFn, "state:governance-decision", (payload) => {
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
  }, [listenFn, refresh]);

  return { mode, decisions, refresh };
}
