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
        "apps/desktop-companion/src/ui/components/BranchRow.tsx",
        "apps/desktop-companion/src/ui/components/LocalSiteCard.tsx",
        "apps/desktop-companion/src/ui/components/RemoteEnvironmentCard.tsx",
        "apps/desktop-companion/src/ui/components/RemoteEnvRow.tsx",
        "apps/desktop-companion/src/ui/components/SiteActivityIndicator.tsx",
        "apps/desktop-companion/src/ui/components/SiteCardExpanded.tsx",
        "apps/desktop-companion/src/ui/components/SkillList.tsx",
        "apps/desktop-companion/src/ui/components/TaskBranchCard.tsx",
        "apps/desktop-companion/src/ui/hooks/**/*.ts",
        "apps/desktop-companion/src/ui/pages/**/*.tsx",
      ],
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
