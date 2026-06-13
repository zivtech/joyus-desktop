import { JSDOM } from "jsdom";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalSiteCard, type LocalSite } from "../../../src/ui/components/LocalSiteCard";

const noop = () => {};
let dom: JSDOM;
let root: Root | undefined;
let container: HTMLElement;
let invokeMock: ReturnType<typeof vi.fn>;

interface ReactButtonProps {
  onClick?: () => void;
}

async function waitForInvokeCount(count: number): Promise<void> {
  for (let i = 0; i < 10; i++) {
    if (invokeMock.mock.calls.length >= count) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function makeSite(overrides: Partial<LocalSite> = {}): LocalSite {
  return {
    id: "site-1",
    projectName: "My Project",
    repoUrl: "https://github.com/acme/web.git",
    repoPath: "/repos/acme/web",
    ddevProjectName: "web",
    status: "running",
    ...overrides,
  };
}

function getReactButtonProps(button: HTMLButtonElement): ReactButtonProps {
  const propsKey = Object.keys(button).find((key) => key.startsWith("__reactProps$"));
  if (propsKey === undefined) {
    throw new Error("React button props not found");
  }
  return (button as unknown as Record<string, unknown>)[propsKey] as ReactButtonProps;
}

describe("LocalSiteCard", () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    globalThis.document = dom.window.document;
    invokeMock = vi.fn().mockResolvedValue(undefined);
    (dom.window as unknown as { __TAURI_INTERNALS__: { invoke: ReturnType<typeof vi.fn> } }).__TAURI_INTERNALS__ = {
      invoke: invokeMock,
    };
    container = dom.window.document.getElementById("root")!;
  });

  afterEach(() => {
    if (root !== undefined) {
      act(() => {
        root?.unmount();
      });
      root = undefined;
    }
    dom.window.close();
    vi.restoreAllMocks();
  });

  it("renders the project name", () => {
    const html = renderToStaticMarkup(
      createElement(LocalSiteCard, { site: makeSite(), onRemoved: noop }),
    );
    expect(html).toContain("My Project");
  });

  it("renders Running status for running sites", () => {
    const html = renderToStaticMarkup(
      createElement(LocalSiteCard, { site: makeSite({ status: "running" }), onRemoved: noop }),
    );
    expect(html).toContain("Running");
  });

  it("renders Stopped status for stopped sites", () => {
    const html = renderToStaticMarkup(
      createElement(LocalSiteCard, { site: makeSite({ status: "stopped" }), onRemoved: noop }),
    );
    expect(html).toContain("Stopped");
  });

  it("renders error message when status is error and errorMessage is set", () => {
    const html = renderToStaticMarkup(
      createElement(LocalSiteCard, {
        site: makeSite({ status: "error", errorMessage: "DDEV crashed" }),
        onRemoved: noop,
      }),
    );
    expect(html).toContain("Error");
    expect(html).toContain("DDEV crashed");
  });

  it("renders repo path", () => {
    const html = renderToStaticMarkup(
      createElement(LocalSiteCard, { site: makeSite(), onRemoved: noop }),
    );
    expect(html).toContain("/repos/acme/web");
  });

  it("renders HTTPS link when httpsUrl is set", () => {
    const html = renderToStaticMarkup(
      createElement(LocalSiteCard, {
        site: makeSite({ httpsUrl: "https://web.ddev.site" }),
        onRemoved: noop,
      }),
    );
    expect(html).toContain("HTTPS");
    expect(html).toContain("https://web.ddev.site");
  });

  it("renders HTTP link when httpUrl is set", () => {
    const html = renderToStaticMarkup(
      createElement(LocalSiteCard, {
        site: makeSite({ httpUrl: "http://web.ddev.site" }),
        onRemoved: noop,
      }),
    );
    expect(html).toContain("HTTP");
    expect(html).toContain("http://web.ddev.site");
  });

  it("renders action buttons", () => {
    const html = renderToStaticMarkup(
      createElement(LocalSiteCard, { site: makeSite(), onRemoved: noop }),
    );
    expect(html).toContain("Start");
    expect(html).toContain("Stop");
    expect(html).toContain("Restart");
    expect(html).toContain("Remove");
  });

  it("renders Open button when a URL is available", () => {
    const html = renderToStaticMarkup(
      createElement(LocalSiteCard, {
        site: makeSite({ httpsUrl: "https://web.ddev.site" }),
        onRemoved: noop,
      }),
    );
    expect(html).toContain("Open");
  });

  it("omits Open button when no URL is available", () => {
    const html = renderToStaticMarkup(
      createElement(LocalSiteCard, {
        site: makeSite({ httpUrl: undefined, httpsUrl: undefined }),
        onRemoved: noop,
      }),
    );
    const buttons = html.match(/>Open</g);
    expect(buttons).toBeNull();
  });

  it("renders chevron when onToggleExpand is provided", () => {
    const html = renderToStaticMarkup(
      createElement(LocalSiteCard, {
        site: makeSite(),
        onRemoved: noop,
        onToggleExpand: noop,
        expanded: false,
      }),
    );
    expect(html).toContain("aria-expanded=\"false\"");
  });

  it("renders expanded chevron and children when expanded", () => {
    const html = renderToStaticMarkup(
      createElement(LocalSiteCard, {
        site: makeSite(),
        onRemoved: noop,
        onToggleExpand: noop,
        expanded: true,
      }, createElement("div", null, "Expanded content")),
    );
    expect(html).toContain("aria-expanded=\"true\"");
    expect(html).toContain("Expanded content");
    expect(html).toContain("role=\"region\"");
  });

  it("renders branch count badge when branchCounts is provided", () => {
    const html = renderToStaticMarkup(
      createElement(LocalSiteCard, {
        site: makeSite(),
        onRemoved: noop,
        branchCounts: { active: 2, total: 5 },
      }),
    );
    expect(html).toContain("2 active / 5 total");
  });

  it("renders activity indicator when lastBranchActivity is provided", () => {
    const html = renderToStaticMarkup(
      createElement(LocalSiteCard, {
        site: makeSite(),
        onRemoved: noop,
        lastBranchActivity: Date.now() - 60_000,
      }),
    );
    expect(html).toContain("Last active");
  });

  it("stops running sites", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(LocalSiteCard, {
        site: makeSite({ status: "running" }),
        onRemoved: noop,
      }));
    });

    const stop = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Stop")!;
    await act(async () => {
      stop.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitForInvokeCount(1);

    expect(invokeMock).toHaveBeenCalledWith("site_stop", { siteId: "site-1" }, undefined);
  });

  it("opens HTTPS URLs through the shell plugin", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(LocalSiteCard, {
        site: makeSite({ httpsUrl: "https://web.ddev.site" }),
        onRemoved: noop,
      }));
    });

    const open = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Open")!;
    await act(async () => {
      open.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitForInvokeCount(1);

    expect(invokeMock).toHaveBeenCalledWith("plugin:shell|open", {
      path: "https://web.ddev.site",
      with: undefined,
    }, undefined);
  });

  it("confirms active branch removal before removing a site", async () => {
    const onRemoved = vi.fn();
    vi.spyOn(dom.window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);

    await act(async () => {
      root = createRoot(container);
      root.render(createElement(LocalSiteCard, {
        site: makeSite(),
        onRemoved,
        branchCounts: { active: 2, total: 4 },
      }));
    });

    const remove = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Remove")!;
    await act(async () => {
      remove.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(invokeMock).not.toHaveBeenCalled();

    await act(async () => {
      remove.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitForInvokeCount(1);

    expect(invokeMock).toHaveBeenCalledWith("site_remove", { siteId: "site-1" }, undefined);
    expect(onRemoved).toHaveBeenCalledTimes(1);
  });

  it("restarts running sites", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(LocalSiteCard, {
        site: makeSite({ status: "running" }),
        onRemoved: noop,
      }));
    });

    const restart = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Restart")!;
    await act(async () => {
      restart.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitForInvokeCount(1);

    expect(invokeMock).toHaveBeenCalledWith("site_restart", { siteId: "site-1" }, undefined);
  });

  it("starts stopped sites and closes expanded content on Escape", async () => {
    const onToggleExpand = vi.fn();

    await act(async () => {
      root = createRoot(container);
      root.render(createElement(LocalSiteCard, {
        site: makeSite({ status: "stopped" }),
        onRemoved: noop,
        expanded: true,
        onToggleExpand,
      }, createElement("div", null, "Expanded content")));
    });

    const start = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Start")!;
    await act(async () => {
      start.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitForInvokeCount(1);

    act(() => {
      dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(invokeMock).toHaveBeenCalledWith("site_start", { siteId: "site-1" }, undefined);
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
  });

  it("falls back cleanly when site commands reject", async () => {
    invokeMock.mockRejectedValueOnce(new Error("offline"));

    await act(async () => {
      root = createRoot(container);
      root.render(createElement(LocalSiteCard, {
        site: makeSite({ status: "stopped" }),
        onRemoved: noop,
      }));
    });

    const start = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Start")!;
    await act(async () => {
      start.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitForInvokeCount(1);

    expect(invokeMock).toHaveBeenCalledWith("site_start", { siteId: "site-1" }, undefined);
  });

  it("uses window.open when shell open is unavailable", async () => {
    invokeMock.mockRejectedValueOnce(new Error("shell unavailable"));
    const openSpy = vi.spyOn(dom.window, "open").mockImplementation(() => null);

    await act(async () => {
      root = createRoot(container);
      root.render(createElement(LocalSiteCard, {
        site: makeSite({ httpsUrl: "https://web.ddev.site" }),
        onRemoved: noop,
      }));
    });

    const open = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Open")!;
    await act(async () => {
      open.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitForInvokeCount(1);

    expect(openSpy).toHaveBeenCalledWith("https://web.ddev.site", "_blank");
  });

  it("opens the HTTP URL when HTTPS is unavailable", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(LocalSiteCard, {
        site: makeSite({ httpUrl: "http://web.ddev.site", httpsUrl: undefined }),
        onRemoved: noop,
      }));
    });

    const open = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Open")!;
    await act(async () => {
      open.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitForInvokeCount(1);

    expect(invokeMock).toHaveBeenCalledWith("plugin:shell|open", {
      path: "http://web.ddev.site",
      with: undefined,
    }, undefined);
  });

  it("ignores direct action callbacks while the site is busy", () => {
    const confirmSpy = vi.spyOn(dom.window, "confirm").mockReturnValue(true);

    act(() => {
      root = createRoot(container);
      root.render(createElement(LocalSiteCard, {
        site: makeSite({ status: "starting", httpsUrl: "https://web.ddev.site" }),
        onRemoved: noop,
      }));
    });

    const start = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Start")!;
    const remove = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Remove")!;

    act(() => {
      getReactButtonProps(start).onClick?.();
      getReactButtonProps(remove).onClick?.();
    });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("uses the simple removal confirmation when no active branches are known", async () => {
    const confirmSpy = vi.spyOn(dom.window, "confirm").mockReturnValueOnce(true);

    await act(async () => {
      root = createRoot(container);
      root.render(createElement(LocalSiteCard, {
        site: makeSite(),
        onRemoved: noop,
      }));
    });

    const remove = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Remove")!;
    await act(async () => {
      remove.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitForInvokeCount(1);

    expect(confirmSpy.mock.calls[0]?.[0]).toBe("Remove \"My Project\"? This cannot be undone.");
  });
});
