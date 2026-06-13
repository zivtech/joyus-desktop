import { describe, expect, it } from "vitest";
import { buildServerActionArgs } from "../../../src/ui/components/ServerCard";

describe("ServerCard command wiring", () => {
  it("builds server lifecycle action args from the server name", () => {
    expect(buildServerActionArgs({ name: "playwright" })).toEqual({
      name: "playwright",
    });
  });
});
