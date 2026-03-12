#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function parseArgs(argv) {
  const options = {
    tester: "tester",
    outDir: "docs/verification/evidence",
    syncRepoUrl: process.env.SKILL_SYNC_REPO_URL,
    syncVersion: process.env.SKILL_SYNC_TARGET_VERSION,
    syncBundle: process.env.SKILL_SYNC_BUNDLE,
    distributionConfig: process.env.SKILL_SYNC_DISTRIBUTION_CONFIG,
    distributionConfigUrl: process.env.SKILL_SYNC_DISTRIBUTION_CONFIG_URL,
    syncDestDir: process.env.SKILL_SYNC_DEST_DIR ?? `${process.env.HOME}/.claude/skills`,
    syncCacheDir: process.env.SKILL_SYNC_CACHE_DIR ?? `${process.env.HOME}/.claude/.skill-sync-cache`
  };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    const next = argv[i + 1];

    if (value === "--tester" && next) {
      options.tester = next;
      i += 1;
      continue;
    }

    if (value === "--out-dir" && next) {
      options.outDir = next;
      i += 1;
      continue;
    }

    if (value === "--repo-url" && next) {
      options.syncRepoUrl = next;
      i += 1;
      continue;
    }

    if (value === "--version" && next) {
      options.syncVersion = next;
      i += 1;
      continue;
    }

    if (value === "--bundle" && next) {
      options.syncBundle = next;
      i += 1;
      continue;
    }

    if (value === "--distribution-config" && next) {
      options.distributionConfig = next;
      i += 1;
      continue;
    }

    if (value === "--distribution-config-url" && next) {
      options.distributionConfigUrl = next;
      i += 1;
      continue;
    }

    if (value === "--dest-dir" && next) {
      options.syncDestDir = next;
      i += 1;
      continue;
    }

    if (value === "--cache-dir" && next) {
      options.syncCacheDir = next;
      i += 1;
      continue;
    }

    if (value === "--help" || value === "-h") {
      return { ...options, help: true };
    }
  }

  return options;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/skill-sync/run-tester-checklist.mjs --tester <name> [--repo-url <url>] [--version <tag>]",
    "  node scripts/skill-sync/run-tester-checklist.mjs --tester <name> [--repo-url <url>] [--bundle <bundle>] [--distribution-config <path>]",
    "",
    "This script runs:",
    "  1) initial sync",
    "  2) status capture",
    "  3) warm-cache sync timing",
    "and writes a markdown evidence report."
  ].join("\n");
}

function run(command, args, env) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    env,
    encoding: "utf8"
  });
  const durationMs = Date.now() - started;

  return {
    command: [command, ...args].join(" "),
    durationMs,
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

function fence(text) {
  return ["```text", text.trim() || "(empty)", "```"].join("\n");
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(usage());
  process.exit(0);
}

if (!options.syncRepoUrl || (!options.syncVersion && !options.syncBundle)) {
  console.error("Missing repo URL and pin selector. Provide --repo-url plus either --version or --bundle.");
  process.exit(1);
}

const env = {
  ...process.env,
  SKILL_SYNC_REPO_URL: options.syncRepoUrl,
  SKILL_SYNC_TARGET_VERSION: options.syncVersion,
  SKILL_SYNC_BUNDLE: options.syncBundle,
  SKILL_SYNC_DISTRIBUTION_CONFIG: options.distributionConfig,
  SKILL_SYNC_DISTRIBUTION_CONFIG_URL: options.distributionConfigUrl,
  SKILL_SYNC_DEST_DIR: options.syncDestDir,
  SKILL_SYNC_CACHE_DIR: options.syncCacheDir
};

const syncCmd = ["exec", "tsx", "packages/skill-sync/src/cli.ts", "--sync", "--quiet"];
const statusCmd = ["exec", "tsx", "packages/skill-sync/src/cli.ts", "--status"];

const firstSync = run("pnpm", syncCmd, env);
const status = run("pnpm", statusCmd, env);
const warmSync = run("pnpm", syncCmd, env);

const pass = firstSync.status === 0 && status.status === 0 && warmSync.status === 0;
const warmUnder10s = warmSync.durationMs < 10_000;
const now = new Date();
const stamp = now.toISOString().replace(/[.:]/g, "-");

mkdirSync(options.outDir, { recursive: true });
const outputPath = join(options.outDir, `wp03-${options.tester}-${stamp}.md`);

const report = [
  `# WP03 Tester Evidence: ${options.tester}`,
  "",
  `- Date: ${now.toISOString()}`,
  `- Repo URL: ${options.syncRepoUrl}`,
  `- Target Version: ${options.syncVersion ?? "(resolved from pin config)"}`,
  `- Bundle: ${options.syncBundle ?? "(none)"}`,
  `- Distribution Config: ${options.distributionConfig ?? "(default path)"}`,
  `- Distribution Config URL: ${options.distributionConfigUrl ?? "(none)"}`,
  `- Destination: ${options.syncDestDir}`,
  `- Cache: ${options.syncCacheDir}`,
  "",
  "## Results",
  "",
  `- First sync exit code: ${firstSync.status}`,
  `- Warm sync exit code: ${warmSync.status}`,
  `- Warm sync duration (ms): ${warmSync.durationMs}`,
  `- Warm sync under 10s: ${warmUnder10s ? "yes" : "no"}`,
  `- Overall pass: ${pass ? "yes" : "no"}`,
  "",
  "## Command Output",
  "",
  `### ${firstSync.command}`,
  fence(firstSync.stdout || firstSync.stderr),
  "",
  `### ${status.command}`,
  fence(status.stdout || status.stderr),
  "",
  `### ${warmSync.command}`,
  fence(warmSync.stdout || warmSync.stderr),
  "",
  "## Manual Checks (mark after interactive testing)",
  "",
  "- [ ] Skills are visible in Claude Code session.",
  "- [ ] A skill invocation succeeds.",
  "- [ ] Session-start hook triggers automatic sync.",
  "- [ ] Offline behavior verified (no blocking error; last good skills available)."
].join("\n");

writeFileSync(outputPath, `${report}\n`, "utf8");
console.log(`Wrote tester evidence: ${outputPath}`);
process.exit(pass ? 0 : 1);
