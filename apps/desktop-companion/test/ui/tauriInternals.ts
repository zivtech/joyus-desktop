import { vi } from "vitest";

type InvokeHandler = (cmd: string, args: Record<string, unknown>) => unknown | Promise<unknown>;
type EventCallback = (event: { event: string; id: number; payload: unknown }) => void;

interface TauriWindow {
  __TAURI_INTERNALS__: {
    invoke: ReturnType<typeof vi.fn>;
    transformCallback: (callback: EventCallback) => number;
    unregisterListener: ReturnType<typeof vi.fn>;
  };
  __TAURI_EVENT_PLUGIN_INTERNALS__: {
    unregisterListener: ReturnType<typeof vi.fn>;
  };
}

export function installTauriInternals(
  win: Window,
  handler: InvokeHandler,
) {
  let nextCallbackId = 1;
  let nextListenerId = 1;
  const callbacks = new Map<number, EventCallback>();
  const listeners = new Map<string, number[]>();
  const invoke = vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
    if (cmd === "plugin:event|listen") {
      const event = args["event"];
      const handlerId = args["handler"];
      if (typeof event === "string" && typeof handlerId === "number") {
        const ids = listeners.get(event) ?? [];
        ids.push(handlerId);
        listeners.set(event, ids);
      }
      return nextListenerId++;
    }
    if (cmd === "plugin:event|unlisten") {
      return undefined;
    }
    return handler(cmd, args);
  });

  (win as unknown as TauriWindow).__TAURI_INTERNALS__ = {
    invoke,
    transformCallback: (callback) => {
      const id = nextCallbackId++;
      callbacks.set(id, callback);
      return id;
    },
    unregisterListener: vi.fn(),
  };
  (win as unknown as TauriWindow).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: vi.fn(),
  };

  return {
    invoke,
    emit(event: string, payload: unknown) {
      for (const id of listeners.get(event) ?? []) {
        callbacks.get(id)?.({ event, id, payload });
      }
    },
  };
}
