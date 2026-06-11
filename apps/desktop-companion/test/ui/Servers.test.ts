import { describe, expect, it } from "vitest";
import { buildServerActionArgs } from "../../src/ui/components/ServerCard";
import { CHROME_DETECT_COMMAND } from "../../src/ui/pages/Servers";

describe("Servers command wiring", () => {
  it("uses the existing Tauri chrome detection command name", () => {
    expect(CHROME_DETECT_COMMAND).toBe("detect_chrome");
  });

  it("builds server lifecycle action args from the server name", () => {
    expect(buildServerActionArgs({ name: "playwright" })).toEqual({
      name: "playwright",
    });
  });
});
