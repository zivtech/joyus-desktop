import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/test/**/*.test.ts"],
    exclude: [
      ".worktrees/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/dist-ui/**",
      "**/coverage/**",
      "apps/**/src-tauri/target/**",
      "**/**.integration.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      all: true,
      include: [
        "apps/**/src/**/*.ts",
        "packages/**/src/**/*.ts",
        "apps/desktop-companion/src/ui/components/BranchCountBadge.tsx",
        "apps/desktop-companion/src/ui/components/SiteActivityIndicator.tsx",
        "apps/desktop-companion/src/ui/components/SkillList.tsx",
        "apps/desktop-companion/src/ui/pages/Servers.tsx",
        "apps/desktop-companion/src/ui/pages/SkillsView.tsx",
      ],
      exclude: [
        "packages/mcp-governance/src/types.ts",
        "packages/mcp-registry/src/types.ts",
        "packages/desktop-sync/src/types.ts",
        "apps/desktop-companion/src/ui/hooks/**",
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
