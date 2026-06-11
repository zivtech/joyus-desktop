import { useCallback, useEffect, useState } from "react";

export interface ServerInfo {
  id: string;
  name: string;
  status: "running" | "stopped" | "error" | "starting";
  pid?: number;
  uptime?: number;
  restartCount: number;
}

interface UseServerStatusResult {
  servers: ServerInfo[];
  loading: boolean;
  error: string | undefined;
  refresh: () => void;
}

async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
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

export function useServerStatus(): UseServerStatusResult {
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);

  const refresh = useCallback(() => {
    setLoading(true);
    void safeInvoke<ServerInfo[]>("get_servers").then((result) => {
      if (result !== undefined) {
        setServers(result);
        setError(undefined);
      }
      setLoading(false);
    }).catch((err: unknown) => {
      setError(String(err));
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    refresh();

    let unlistenFn: (() => void) | undefined;
    let active = true;
    void safeListen("state:server-changed", (payload) => {
      const updated = payload as ServerInfo;
      setServers((prev) => {
        const idx = prev.findIndex((s) => s.id === updated.id);
        if (idx >= 0) {
          return [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)];
        }
        return [...prev, updated];
      });
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

  return { servers, loading, error, refresh };
}
