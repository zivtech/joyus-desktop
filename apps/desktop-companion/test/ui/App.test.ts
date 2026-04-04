import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Outlet } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/ui/components/Layout", () => ({
  Layout: () => createElement("div", null, createElement(Outlet)),
}));

import { App } from "../../src/ui/App";

describe("App routing", () => {
  it("renders the Servers page instead of the placeholder route", () => {
    const html = renderToStaticMarkup(
      createElement(App, {
        initialEntries: ["/servers"],
        initialOnboardingComplete: true,
      })
    );

    expect(html).toContain("MCP Servers");
    expect(html).not.toContain("Coming soon.");
  });

  it("renders the Skills page instead of the placeholder route", () => {
    const html = renderToStaticMarkup(
      createElement(App, {
        initialEntries: ["/skills"],
        initialOnboardingComplete: true,
      })
    );

    expect(html).toContain("Skills");
    expect(html).not.toContain("Coming soon.");
  });
});
