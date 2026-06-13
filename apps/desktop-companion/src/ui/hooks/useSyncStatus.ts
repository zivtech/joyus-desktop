import { useCallback, useEffect, useState } from "react";

export interface SyncStatus {
  state: "idle" | "syncing" | "error" | "up_to_date";
  lastSync: string | undefined;
  version: string | undefined;
  nextSync: string | undefined;
}

interface UseSyncStatusResult {
  status: SyncStatus;
  lastSync: string | undefined;
  version: string | undefined;
  refresh: () => void;
}

type InvokeFn = <T>(cmd: string) => Promise<T | undefined>;
type ListenFn = (
  event: string,
  handler: (payload: unknown) => void
) => Promise<() => void>;

interface UseSyncStatusDeps {
  readonly invoke?: InvokeFn;
  readonly listen?: ListenFn;
}

const DEFAULT_STATUS: SyncStatus = {
  state: "idle",
  lastSync: undefined,
  version: undefined,
  nextSync: undefined,
};

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

export function useSyncStatus(deps: UseSyncStatusDeps = {}): UseSyncStatusResult {
  const invokeFn = deps.invoke ?? defaultInvoke;
  const listenFn = deps.listen ?? defaultListen;
  const [status, setStatus] = useState<SyncStatus>(DEFAULT_STATUS);

  const refresh = useCallback(() => {
    void safeInvoke<SyncStatus>(invokeFn, "get_sync_status").then((result) => {
      if (result !== undefined) {
        setStatus(result);
      }
    });
  }, [invokeFn]);

  useEffect(() => {
    refresh();

    let unlistenFn: (() => void) | undefined;
    let active = true;
    void safeListen(listenFn, "state:sync-completed", (payload) => {
      const updated = payload as Partial<SyncStatus>;
      setStatus((prev) => ({ ...prev, ...updated }));
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

  return { status, lastSync: status.lastSync, version: status.version, refresh };
}
