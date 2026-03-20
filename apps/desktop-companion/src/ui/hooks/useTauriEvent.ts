import { useEffect, useState } from "react";

type UnlistenFn = () => void;

interface TauriEvent<T> {
  payload: T;
}

// Lazily import listen to avoid crashing in non-Tauri environments (tests/node)
async function safeListen<T>(
  event: string,
  handler: (e: TauriEvent<T>) => void
): Promise<UnlistenFn> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<T>(event, handler);
  } catch {
    return () => undefined;
  }
}

export function useTauriEvent<T>(eventName: string): T | undefined {
  const [payload, setPayload] = useState<T | undefined>(undefined);

  useEffect(() => {
    let unlistenFn: UnlistenFn | undefined;
    let active = true;

    void safeListen<T>(eventName, (e) => {
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
  }, [eventName]);

  return payload;
}
