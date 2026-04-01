import { describe, it, expect } from "vitest";

import {
  createDockerClient,
  createRuntimeDetector,
  createDdevCli,
  classifyDdevError,
  openLocalSiteStore,
  mapRowToLocalSite,
  createLocalSiteManager,
  extractDdevProjectName,
} from "../src/index.js";

describe("barrel exports", () => {
  it("re-exports all public factory functions", () => {
    expect(createDockerClient).toBeTypeOf("function");
    expect(createRuntimeDetector).toBeTypeOf("function");
    expect(createDdevCli).toBeTypeOf("function");
    expect(classifyDdevError).toBeTypeOf("function");
    expect(openLocalSiteStore).toBeTypeOf("function");
    expect(mapRowToLocalSite).toBeTypeOf("function");
    expect(createLocalSiteManager).toBeTypeOf("function");
    expect(extractDdevProjectName).toBeTypeOf("function");
  });
});
