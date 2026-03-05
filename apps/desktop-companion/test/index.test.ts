import { describe, expect, it } from "vitest";

import { authorizeAction, executeRuntimeAction, planRuntimeExecution } from "../src/index";

describe("desktop-companion package entrypoint", () => {
  it("re-exports runtime and authorization APIs", () => {
    expect(typeof authorizeAction).toBe("function");
    expect(typeof planRuntimeExecution).toBe("function");
    expect(typeof executeRuntimeAction).toBe("function");
  });
});
