import { JSDOM } from "jsdom";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GovernanceDecision, GovernanceMode } from "../../src/ui/hooks/useGovernance";

const governanceState = vi.hoisted(() => ({
  mode: undefined as GovernanceMode | undefined,
  decisions: [] as GovernanceDecision[],
  refresh: vi.fn(),
}));

vi.mock("../../src/ui/hooks/useGovernance", () => ({
  useGovernance: () => ({
    mode: governanceState.mode,
    decisions: governanceState.decisions,
    refresh: governanceState.refresh,
  }),
}));

import { Governance, formatGovernanceTimestamp } from "../../src/ui/pages/Governance";

let dom: JSDOM;
let root: Root | undefined;
let container: HTMLElement;

function decision(
  id: string,
  outcome: GovernanceDecision["outcome"],
  action = "github:create-pr",
): GovernanceDecision {
  return {
    id,
    timestamp: "2026-06-13T12:00:00Z",
    action,
    outcome,
    reason: `${outcome} reason`,
  };
}

function renderGovernance(): string {
  return renderToStaticMarkup(createElement(Governance));
}

describe("Governance page", () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    globalThis.document = dom.window.document;
    container = dom.window.document.getElementById("root")!;
    governanceState.mode = undefined;
    governanceState.decisions = [];
    governanceState.refresh = vi.fn();
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

  it("shows loading governance mode and the empty decisions state", () => {
    const html = renderGovernance();

    expect(html).toContain("Governance");
    expect(html).toContain("Loading governance mode");
    expect(html).toContain("No governance decisions recorded yet.");
  });

  it("shows strict mode copy and decision rows", () => {
    governanceState.mode = "strict";
    governanceState.decisions = [
      decision("d1", "allow", "github:create-pr"),
      decision("d2", "deny", "filesystem:write"),
      decision("d3", "escalate", "browser:open"),
    ];

    const html = renderGovernance();

    expect(html).toContain("strict");
    expect(html).toContain("All tool calls require explicit approval");
    expect(html).toContain("github:create-pr");
    expect(html).toContain("filesystem:write");
    expect(html).toContain("browser:open");
    expect(html).toContain("allow");
    expect(html).toContain("deny");
    expect(html).toContain("escalate");
    expect(html).toContain("All Servers");
  });

  it("falls back to standard styling and empty copy for an unknown mode", () => {
    governanceState.mode = "audit" as GovernanceMode;
    governanceState.decisions = [decision("d1", "allow", "")];

    const html = renderGovernance();

    expect(html).toContain("audit");
    expect(html).toContain("unknown");
  });

  it("paginates decisions at twenty rows", () => {
    governanceState.mode = "permissive";
    governanceState.decisions = Array.from({ length: 25 }, (_, i) =>
      decision(`d${i}`, "allow", `tool-${i}:run`),
    );

    const html = renderGovernance();

    expect(html).toContain("tool-0:run");
    expect(html).toContain("tool-19:run");
    expect(html).not.toContain("tool-20:run");
    expect(html).toContain("1 / 2");
    expect(html).toContain("Next");
    expect(html).not.toContain("No governance decisions recorded yet.");
  });

  it("executes refresh, filtering, server selection, and pagination controls", () => {
    governanceState.mode = "standard";
    governanceState.decisions = Array.from({ length: 25 }, (_, i) => {
      const outcome = i % 2 === 0 ? "allow" : "deny";
      const server = i % 3 === 0 ? "browser" : "github";
      return decision(`d${i}`, outcome, `${server}:action-${i}`);
    });

    act(() => {
      root = createRoot(container);
      root.render(createElement(Governance));
    });

    const text = () => container.textContent ?? "";
    const button = (label: string) =>
      Array.from(container.querySelectorAll("button")).find((node) => node.textContent === label)!;

    act(() => {
      button("Refresh").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    expect(governanceState.refresh).toHaveBeenCalledTimes(1);

    act(() => {
      button("Deny").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    expect(text()).toContain("github:action-1");
    expect(text()).not.toContain("browser:action-0");

    const select = container.querySelector("select")!;
    act(() => {
      select.value = "browser";
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    expect(text()).toContain("browser:action-3");
    expect(text()).not.toContain("github:action-1");

    act(() => {
      button("All").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      select.value = "all";
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });

    expect(text()).toContain("browser:action-0");
    expect(text()).not.toContain("github:action-20");

    act(() => {
      button("Next").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    expect(text()).toContain("2 / 2");
    expect(text()).toContain("github:action-20");
    expect(text()).not.toContain("browser:action-0");

    act(() => {
      button("Prev").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    expect(text()).toContain("1 / 2");
    expect(text()).toContain("browser:action-0");
  });

  it("returns invalid timestamps unchanged", () => {
    expect(formatGovernanceTimestamp("not-a-date")).toBe("not-a-date");
  });
});
