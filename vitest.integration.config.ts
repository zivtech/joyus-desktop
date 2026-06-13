import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/test/**/*.integration.test.ts", "apps/**/test/**/*.integration.test.ts"],
    exclude: [
      ".worktrees/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/dist-ui/**",
      "**/coverage/**",
      "apps/**/src-tauri/target/**",
    ],
  },
});
