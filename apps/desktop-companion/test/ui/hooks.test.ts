import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChromeAvailable } from "../../src/ui/hooks/useChromeAvailable";
import { useGovernance, type GovernanceDecision } from "../../src/ui/hooks/useGovernance";
import { useReconSetup } from "../../src/ui/hooks/useRecon";
import { useServerStatus, type ServerInfo } from "../../src/ui/hooks/useServerStatus";
import { useSyncStatus, type SyncStatus } from "../../src/ui/hooks/useSyncStatus";
import { useTauriEvent } from "../../src/ui/hooks/useTauriEvent";

type HookCapture<T> = {
  current: T | undefined;
};

let dom: JSDOM;
let root: Root | undefined;
let container: HTMLElement;
let invokeMock: ReturnType<typeof vi.fn>;
let listenMock: ReturnType<typeof vi.fn>;

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function mountHook<T>(useHook: () => T): HookCapture<T> {
  const capture: HookCapture<T> = { current: undefined };

  function Harness() {
    capture.current = useHook();
    return createElement("div");
  }

  act(() => {
    root = createRoot(container);
    root.render(createElement(Harness));
  });

  return capture;
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await flushPromises();
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (predicate()) return;
    await flushEffects();
  }
  throw new Error("Timed out waiting for condition");
}

describe("UI hooks", () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    globalThis.document = dom.window.document;
    container = dom.window.document.getElementById("root")!;
    invokeMock = vi.fn();
    listenMock = vi.fn().mockResolvedValue(vi.fn());
  });

  afterEach(() => {
    if (root !== undefined) {
      act(() => {
        root?.unmount();
      });
      root = undefined;
    }
    dom.window.close();
    vi.clearAllMocks();
  });

  it("loads Chrome availability from the Tauri command", async () => {
    invokeMock.mockResolvedValueOnce({ available: true });

    const capture = mountHook(() => useChromeAvailable({ invoke: invokeMock }));
    expect(capture.current).toBeUndefined();

    await flushEffects();

    expect(invokeMock).toHaveBeenCalledWith("detect_chrome");
    expect(capture.current).toBe(true);
  });

  it("leaves Chrome availability unknown when detection fails", async () => {
    invokeMock.mockRejectedValueOnce(new Error("no tauri"));

    const capture = mountHook(() => useChromeAvailable({ invoke: invokeMock }));
    await flushEffects();

    expect(capture.current).toBeUndefined();
  });

  it("loads governance mode and prepends decision events", async () => {
    const decision: GovernanceDecision = {
      id: "d1",
      timestamp: "2026-06-13T01:00:00Z",
      action: "github:create-pr",
      outcome: "allow",
      reason: "approved",
    };
    let listener: ((payload: GovernanceDecision) => void) | undefined;
    invokeMock
      .mockResolvedValueOnce("strict")
      .mockResolvedValueOnce([]);
    listenMock.mockImplementation((_event, handler) => {
      listener = handler as typeof listener;
      return Promise.resolve(vi.fn());
    });

    const capture = mountHook(() => useGovernance({ invoke: invokeMock, listen: listenMock }));
    await flushEffects();

    expect(capture.current?.mode).toBe("strict");
    expect(capture.current?.decisions).toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith("get_governance_mode");
    expect(invokeMock).toHaveBeenCalledWith("get_governance_decisions");

    act(() => {
      listener?.(decision);
    });

    expect(capture.current?.decisions).toEqual([decision]);
  });

  it("keeps governance state stable when commands and listener fail", async () => {
    invokeMock.mockRejectedValue(new Error("offline"));
    listenMock.mockRejectedValueOnce(new Error("no event bus"));

    const capture = mountHook(() => useGovernance({ invoke: invokeMock, listen: listenMock }));
    await flushEffects();

    expect(capture.current?.mode).toBeUndefined();
    expect(capture.current?.decisions).toEqual([]);
  });

  it("cleans up governance listeners that resolve after unmount", async () => {
    const unlisten = vi.fn();
    const pending = deferred<() => void>();
    invokeMock.mockResolvedValue(undefined);
    listenMock.mockReturnValueOnce(pending.promise);

    mountHook(() => useGovernance({ invoke: invokeMock, listen: listenMock }));
    act(() => {
      root?.unmount();
      root = undefined;
    });

    await act(async () => {
      pending.resolve(unlisten);
      await flushPromises();
    });

    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("loads sync status and merges completion events", async () => {
    const initial: SyncStatus = {
      state: "idle",
      lastSync: undefined,
      version: "1.0.0",
      nextSync: undefined,
    };
    let listener: ((payload: Partial<SyncStatus>) => void) | undefined;
    invokeMock.mockResolvedValueOnce(initial);
    listenMock.mockImplementation((_event, handler) => {
      listener = handler as typeof listener;
      return Promise.resolve(vi.fn());
    });

    const capture = mountHook(() => useSyncStatus({ invoke: invokeMock, listen: listenMock }));
    await flushEffects();

    expect(capture.current?.status).toEqual(initial);
    expect(capture.current?.version).toBe("1.0.0");

    act(() => {
      listener?.({ state: "up_to_date", lastSync: "now" });
    });

    expect(capture.current?.status).toMatchObject({
      state: "up_to_date",
      version: "1.0.0",
      lastSync: "now",
    });
  });

  it("cleans up sync listeners that resolve after unmount", async () => {
    const unlisten = vi.fn();
    const pending = deferred<() => void>();
    invokeMock.mockResolvedValue(undefined);
    listenMock.mockReturnValueOnce(pending.promise);

    mountHook(() => useSyncStatus({ invoke: invokeMock, listen: listenMock }));
    act(() => {
      root?.unmount();
      root = undefined;
    });

    await act(async () => {
      pending.resolve(unlisten);
      await flushPromises();
    });

    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("keeps default sync status when refresh and listener fail", async () => {
    invokeMock.mockRejectedValueOnce(new Error("offline"));
    listenMock.mockRejectedValueOnce(new Error("no event bus"));

    const capture = mountHook(() => useSyncStatus({ invoke: invokeMock, listen: listenMock }));
    await flushEffects();

    expect(capture.current?.status.state).toBe("idle");
    expect(capture.current?.version).toBeUndefined();
  });

  it("loads servers and updates the changed server in place", async () => {
    const servers: ServerInfo[] = [
      { id: "browser", name: "browser", status: "running", restartCount: 0 },
    ];
    const updated: ServerInfo = {
      id: "browser",
      name: "browser",
      status: "stopped",
      restartCount: 1,
    };
    let listener: ((payload: ServerInfo) => void) | undefined;
    invokeMock.mockResolvedValueOnce(servers);
    listenMock.mockImplementation((_event, handler) => {
      listener = handler as typeof listener;
      return Promise.resolve(vi.fn());
    });

    const capture = mountHook(() => useServerStatus({ invoke: invokeMock, listen: listenMock }));
    expect(capture.current?.loading).toBe(true);
    await flushEffects();

    expect(capture.current?.loading).toBe(false);
    expect(capture.current?.servers).toEqual(servers);

    act(() => {
      listener?.(updated);
    });

    expect(capture.current?.servers).toEqual([updated]);
  });

  it("adds server-change events that are not already in the list", async () => {
    const added: ServerInfo = {
      id: "github",
      name: "github",
      status: "starting",
      restartCount: 0,
    };
    let listener: ((payload: ServerInfo) => void) | undefined;
    invokeMock.mockResolvedValueOnce([]);
    listenMock.mockImplementation((_event, handler) => {
      listener = handler as typeof listener;
      return Promise.resolve(vi.fn());
    });

    const capture = mountHook(() => useServerStatus({ invoke: invokeMock, listen: listenMock }));
    await flushEffects();

    act(() => {
      listener?.(added);
    });

    expect(capture.current?.servers).toEqual([added]);
  });

  it("cleans up server listeners that resolve after unmount", async () => {
    const unlisten = vi.fn();
    const pending = deferred<() => void>();
    invokeMock.mockResolvedValue(undefined);
    listenMock.mockReturnValueOnce(pending.promise);

    mountHook(() => useServerStatus({ invoke: invokeMock, listen: listenMock }));
    act(() => {
      root?.unmount();
      root = undefined;
    });

    await act(async () => {
      pending.resolve(unlisten);
      await flushPromises();
    });

    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("stops loading and keeps the server list empty when server loading fails", async () => {
    invokeMock.mockRejectedValueOnce(new Error("offline"));

    const capture = mountHook(() => useServerStatus({ invoke: invokeMock, listen: listenMock }));
    await flushEffects();

    expect(capture.current?.loading).toBe(false);
    expect(capture.current?.servers).toEqual([]);
    expect(capture.current?.error).toBeUndefined();
  });

  it("stops loading when server listener registration fails", async () => {
    invokeMock.mockResolvedValueOnce([]);
    listenMock.mockRejectedValueOnce(new Error("no event bus"));

    const capture = mountHook(() => useServerStatus({ invoke: invokeMock, listen: listenMock }));
    await flushEffects();

    expect(capture.current?.loading).toBe(false);
    expect(capture.current?.servers).toEqual([]);
  });

  it("reports Recon setup complete only when credentials and skill file are present", async () => {
    invokeMock
      .mockResolvedValueOnce([
        { key: "ANTHROPIC_API_KEY", isSet: true },
        { key: "DATAFORSEO_USERNAME", isSet: true },
        { key: "DATAFORSEO_PASSWORD", isSet: true },
        { key: "CRUX_API_KEY", isSet: true },
      ])
      .mockResolvedValueOnce({ found: true });

    const capture = mountHook(() => useReconSetup({ invoke: invokeMock }));
    await flushEffects();

    expect(capture.current).toEqual({
      loading: false,
      missingSteps: [],
      setupComplete: true,
    });
  });

  it("reports both Recon setup gaps when sidecar checks are unavailable", async () => {
    invokeMock.mockResolvedValue(undefined);

    const capture = mountHook(() => useReconSetup({ invoke: invokeMock }));
    await flushEffects();

    expect(capture.current).toEqual({
      loading: false,
      missingSteps: ["credentials", "skill-file"],
      setupComplete: false,
    });
  });

  it("reports partial Recon credential and skill-file failures", async () => {
    invokeMock
      .mockResolvedValueOnce([{ key: "ANTHROPIC_API_KEY", isSet: true }])
      .mockRejectedValueOnce(new Error("skill check failed"));

    const capture = mountHook(() => useReconSetup({ invoke: invokeMock }));
    await flushEffects();

    expect(capture.current).toEqual({
      loading: false,
      missingSteps: ["credentials", "skill-file"],
      setupComplete: false,
    });
  });

  it("captures the latest Tauri event payload and unlistens on unmount", async () => {
    const unlisten = vi.fn();
    let listener: ((event: { payload: { ok: boolean } }) => void) | undefined;
    listenMock.mockImplementation((_event, handler) => {
      listener = handler as typeof listener;
      return Promise.resolve(unlisten);
    });

    const capture = mountHook(() => useTauriEvent<{ ok: boolean }>("ready", { listen: listenMock }));
    await flushEffects();

    act(() => {
      listener?.({ payload: { ok: true } });
    });
    expect(capture.current).toEqual({ ok: true });

    act(() => {
      root?.unmount();
      root = undefined;
    });
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("uses a no-op unlistener when Tauri event subscription fails", async () => {
    listenMock.mockRejectedValueOnce(new Error("no tauri"));

    const capture = mountHook(() => useTauriEvent<string>("ready", { listen: listenMock }));
    await flushEffects();

    expect(capture.current).toBeUndefined();
  });

  it("cleans up Tauri event listeners that resolve after unmount", async () => {
    const unlisten = vi.fn();
    const pending = deferred<() => void>();
    listenMock.mockReturnValueOnce(pending.promise);

    mountHook(() => useTauriEvent<string>("ready", { listen: listenMock }));
    act(() => {
      root?.unmount();
      root = undefined;
    });

    await act(async () => {
      pending.resolve(unlisten);
      await flushPromises();
    });

    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("keeps default non-Tauri fallbacks quiet", async () => {
    const chrome = mountHook(useChromeAvailable);
    await flushEffects();
    expect(chrome.current).toBeUndefined();

    act(() => {
      root?.unmount();
    });
    root = undefined;

    const governance = mountHook(useGovernance);
    await flushEffects();
    expect(governance.current?.decisions).toEqual([]);

    act(() => {
      root?.unmount();
    });
    root = undefined;

    const sync = mountHook(useSyncStatus);
    await flushEffects();
    expect(sync.current?.status.state).toBe("idle");

    act(() => {
      root?.unmount();
    });
    root = undefined;

    const servers = mountHook(useServerStatus);
    await waitFor(() => servers.current?.loading === false);
    expect(servers.current?.loading).toBe(false);

    act(() => {
      root?.unmount();
    });
    root = undefined;

    const recon = mountHook(useReconSetup);
    await waitFor(() => recon.current?.loading === false);
    expect(recon.current?.missingSteps).toEqual(["credentials", "skill-file"]);

    act(() => {
      root?.unmount();
    });
    root = undefined;

    const event = mountHook(() => useTauriEvent<string>("ready"));
    await flushEffects();
    expect(event.current).toBeUndefined();
  });
});
