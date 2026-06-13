import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteEnvRow } from "../../../src/ui/components/RemoteEnvRow";
import type { RemoteEnvironment } from "../../../src/ui/components/RemoteEnvironmentCard";

let dom: JSDOM;
let root: Root | undefined;
let container: HTMLElement;

function makeEnv(overrides: Partial<RemoteEnvironment> = {}): RemoteEnvironment {
  return {
    id: "env-1",
    repoOwner: "acme",
    repoName: "web",
    environmentType: "probo",
    status: "active",
    ...overrides,
  };
}

describe("RemoteEnvRow", () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    globalThis.document = dom.window.document;
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
  });

  it("renders the environment type label", () => {
    const html = renderToStaticMarkup(createElement(RemoteEnvRow, { env: makeEnv() }));
    expect(html).toContain("Probo");
  });

  it("renders joyus-ai-hosted type", () => {
    const html = renderToStaticMarkup(
      createElement(RemoteEnvRow, { env: makeEnv({ environmentType: "joyus-ai-hosted" }) }),
    );
    expect(html).toContain("Joyus AI");
  });

  it("renders the status text", () => {
    const html = renderToStaticMarkup(createElement(RemoteEnvRow, { env: makeEnv({ status: "building" }) }));
    expect(html).toContain("building");
  });

  it("renders active status without falling through to the default color", () => {
    const html = renderToStaticMarkup(createElement(RemoteEnvRow, { env: makeEnv({ status: "active" }) }));
    expect(html).toContain("active");
  });

  it("renders unknown status through the fallback path", () => {
    const html = renderToStaticMarkup(createElement(RemoteEnvRow, { env: makeEnv({ status: "paused" }) }));
    expect(html).toContain("paused");
  });

  it("renders failed status through the error color path", () => {
    const html = renderToStaticMarkup(createElement(RemoteEnvRow, { env: makeEnv({ status: "failed" }) }));
    expect(html).toContain("failed");
  });

  it("renders PR link when prUrl and prNumber are set", () => {
    const html = renderToStaticMarkup(
      createElement(RemoteEnvRow, {
        env: makeEnv({ prUrl: "https://github.com/acme/web/pull/42", prNumber: 42 }),
      }),
    );
    expect(html).toContain("PR #42");
    expect(html).toContain("https://github.com/acme/web/pull/42");
  });

  it("renders Open link when environmentUrl is set", () => {
    const html = renderToStaticMarkup(
      createElement(RemoteEnvRow, { env: makeEnv({ environmentUrl: "https://env.example.com" }) }),
    );
    expect(html).toContain("Open");
    expect(html).toContain("https://env.example.com");
  });

  it("omits Open link when environmentUrl is undefined", () => {
    const html = renderToStaticMarkup(
      createElement(RemoteEnvRow, { env: makeEnv({ environmentUrl: undefined }) }),
    );
    expect(html).not.toContain("Open");
  });

  it("stops propagation from PR and environment links", () => {
    const onParentClick = vi.fn();

    act(() => {
      root = createRoot(container);
      root.render(createElement("div", { onClick: onParentClick },
        createElement(RemoteEnvRow, {
          env: makeEnv({
            prUrl: "https://github.com/acme/web/pull/42",
            prNumber: 42,
            environmentUrl: "https://env.example.com",
          }),
        }),
      ));
    });

    for (const link of Array.from(container.querySelectorAll("a"))) {
      act(() => {
        link.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      });
    }

    expect(onParentClick).not.toHaveBeenCalled();
  });
});
