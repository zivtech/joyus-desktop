import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      all: true,
      include: ["apps/**/src/**/*.ts", "packages/**/src/**/*.ts"],
      exclude: [
        "packages/mcp-governance/src/types.ts",
        "packages/mcp-registry/src/types.ts",
        "packages/desktop-sync/src/types.ts",
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100
      }
    }
  }
});
