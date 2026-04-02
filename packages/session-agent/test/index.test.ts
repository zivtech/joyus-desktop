import { describe, expect, it } from "vitest";
import * as publicApi from "../src/index";

describe("session-agent index exports", () => {
  it("re-exports the output ledger and runtime routing helpers", () => {
    expect(typeof publicApi.buildOutputEvent).toBe("function");
    expect(typeof publicApi.planDualWrite).toBe("function");
    expect(typeof publicApi.sendOutputEvent).toBe("function");
    expect(typeof publicApi.selectRuntimeTarget).toBe("function");
    expect(typeof publicApi.shouldFailClosed).toBe("function");
  });
});
