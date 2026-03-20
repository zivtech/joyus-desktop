import type { TopicDomain } from "../../../kitty-specs/006-managed-git-sessions/contracts/drift-detector.js";

const DOMAIN_KEYWORDS: ReadonlyMap<TopicDomain, readonly string[]> = new Map([
  ["frontend", ["components", "ui", "pages", "views", "styles", "css", "scss", "tsx", "jsx"]],
  ["backend", ["api", "routes", "controllers", "handlers", "middleware", "server", "services"]],
  ["testing", ["test", "spec", "__tests__", "fixtures", "mocks", "vitest"]],
  ["documentation", ["docs", "documentation", "readme", "changelog", "md"]],
  ["configuration", ["config", "settings", "env", ".github", "ci", "cd", ".claude"]],
  ["data", ["schema", "migration", "db", "database", "models", "sqlite"]],
  ["tooling", ["scripts", "bin", "tools", "build", "vite", "rollup", "esbuild"]],
  ["security", ["auth", "security", "permissions", "crypto", "jwt", "token"]],
]);

export function inferTopicDomain(filePath: string): TopicDomain {
  const normalized = filePath.toLowerCase();
  const segments = normalized.split("/").filter((s) => s.length > 0);

  for (const segment of segments) {
    for (const [domain, keywords] of DOMAIN_KEYWORDS) {
      if (keywords.includes(segment)) {
        return domain;
      }
    }
  }

  // Fallback: check file extension
  const lastSegment = segments[segments.length - 1];
  if (lastSegment !== undefined) {
    const dotIndex = lastSegment.lastIndexOf(".");
    if (dotIndex !== -1) {
      const ext = lastSegment.slice(dotIndex + 1);
      for (const [domain, keywords] of DOMAIN_KEYWORDS) {
        if (keywords.includes(ext)) {
          return domain;
        }
      }
    }
  }

  return "other";
}

export class TopicDomainInferrer {
  infer(filePath: string): TopicDomain {
    return inferTopicDomain(filePath);
  }
}
