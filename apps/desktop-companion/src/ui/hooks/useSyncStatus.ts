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

const DEFAULT_STATUS: SyncStatus = {
  state: "idle",
  lastSync: undefined,
  version: undefined,
  nextSync: undefined,
};

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

export function useSyncStatus(): UseSyncStatusResult {
  const [status, setStatus] = useState<SyncStatus>(DEFAULT_STATUS);

  const refresh = useCallback(() => {
    void safeInvoke<SyncStatus>("get_sync_status").then((result) => {
      if (result !== undefined) {
        setStatus(result);
      }
    });
  }, []);

  useEffect(() => {
    refresh();

    let unlisten: (() => void) | undefined;
    void safeListen("state:sync-completed", (payload) => {
      const updated = payload as Partial<SyncStatus>;
      setStatus((prev) => ({ ...prev, ...updated }));
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [refresh]);

  return { status, lastSync: status.lastSync, version: status.version, refresh };
}
