import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SkillList } from "../../../src/ui/components/SkillList";

describe("SkillList", () => {
  it("shows an empty installed state", () => {
    const html = renderToStaticMarkup(createElement(SkillList, { skills: [] }));

    expect(html).toContain("No skills installed.");
  });

  it("renders skill metadata in table rows", () => {
    const html = renderToStaticMarkup(
      createElement(SkillList, {
        skills: [
          {
            name: "browser",
            version: "0.1.0",
            bundle: "core",
            path: "/skills/browser",
          },
        ],
      }),
    );

    expect(html).toContain("Name");
    expect(html).toContain("browser");
    expect(html).toContain("0.1.0");
    expect(html).toContain("core");
    expect(html).toContain("/skills/browser");
  });
});
