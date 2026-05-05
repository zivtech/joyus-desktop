import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BranchCountBadge } from "../../../src/ui/components/BranchCountBadge";

describe("BranchCountBadge", () => {
  it("renders 'No branches' when total is 0", () => {
    const html = renderToStaticMarkup(createElement(BranchCountBadge, { active: 0, total: 0 }));
    expect(html).toContain("No branches");
  });

  it("renders active and total counts", () => {
    const html = renderToStaticMarkup(createElement(BranchCountBadge, { active: 3, total: 5 }));
    expect(html).toContain("3 active / 5 total");
  });

  it("does not render 'No branches' when total > 0", () => {
    const html = renderToStaticMarkup(createElement(BranchCountBadge, { active: 0, total: 1 }));
    expect(html).not.toContain("No branches");
    expect(html).toContain("0 active / 1 total");
  });
});
