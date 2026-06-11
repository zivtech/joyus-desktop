import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SiteActivityIndicator } from "../../../src/ui/components/SiteActivityIndicator";

describe("SiteActivityIndicator", () => {
  it("renders a dash when lastActivityAt is undefined", () => {
    const html = renderToStaticMarkup(createElement(SiteActivityIndicator, { lastActivityAt: undefined }));
    expect(html).toContain("—");
    expect(html).not.toContain("Last active");
  });

  it("renders 'Last active' with a relative time when given a timestamp", () => {
    const html = renderToStaticMarkup(
      createElement(SiteActivityIndicator, { lastActivityAt: Date.now() - 60_000 }),
    );
    expect(html).toContain("Last active");
  });
});
