import { useEffect, useState } from "react";

type UnlistenFn = () => void;

interface TauriEvent<T> {
  payload: T;
}

type ListenFn = <T>(
  event: string,
  handler: (e: TauriEvent<T>) => void
) => Promise<UnlistenFn>;

interface UseTauriEventDeps {
  readonly listen?: ListenFn;
}

// Lazily import listen to avoid crashing in non-Tauri environments (tests/node)
async function defaultListen<T>(
  event: string,
  handler: (e: TauriEvent<T>) => void
): Promise<UnlistenFn> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<T>(event, handler);
  } catch {
    return () => undefined;
  }
}

async function safeListen<T>(
  listenFn: ListenFn,
  event: string,
  handler: (e: TauriEvent<T>) => void
): Promise<UnlistenFn> {
  try {
    return await listenFn<T>(event, handler);
  } catch {
    return () => undefined;
  }
}

export function useTauriEvent<T>(
  eventName: string,
  deps: UseTauriEventDeps = {}
): T | undefined {
  const listenFn = deps.listen ?? defaultListen;
  const [payload, setPayload] = useState<T | undefined>(undefined);

  useEffect(() => {
    let unlistenFn: UnlistenFn | undefined;
    let active = true;

    void safeListen<T>(listenFn, eventName, (e) => {
      setPayload(e.payload);
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
  }, [eventName, listenFn]);

  return payload;
}
