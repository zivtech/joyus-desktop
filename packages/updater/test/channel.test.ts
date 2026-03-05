import { describe, expect, it } from "vitest";
import { resolveReleaseChannel } from "../src/channel";

describe("resolveReleaseChannel", () => {
  it("uses alpha in development", () => {
    expect(resolveReleaseChannel("development", false)).toBe("alpha");
  });

  it("uses beta in staging", () => {
    expect(resolveReleaseChannel("staging", false)).toBe("beta");
  });

  it("uses beta for production pilot tenants", () => {
    expect(resolveReleaseChannel("production", true)).toBe("beta");
  });

  it("uses stable for production non-pilot tenants", () => {
    expect(resolveReleaseChannel("production", false)).toBe("stable");
  });
});
