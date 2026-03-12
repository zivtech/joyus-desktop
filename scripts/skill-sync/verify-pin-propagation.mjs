#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function run(command, args, env) {
  const start = Date.now();
  const result = spawnSync(command, args, {
    env,
    encoding: "utf8"
  });
  const durationMs = Date.now() - start;

  return {
    command: [command, ...args].join(" "),
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    durationMs
  };
}

function runGit(args, cwd) {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore"
  });
}

function createRepo(baseDir) {
  const repo = join(baseDir, "skills-repo");
  mkdirSync(join(repo, "skills", "proposal"), { recursive: true });
  runGit(["init", repo]);
  runGit(["-C", repo, "config", "user.email", "wp04@test.local"]);
  runGit(["-C", repo, "config", "user.name", "WP04 Tester"]);

  writeFileSync(join(repo, "skills", "proposal", "SKILL.md"), "# Proposal v1.0.0\nMARKER=v1.0.0\n", "utf8");
  runGit(["-C", repo, "add", "."]);
  runGit(["-C", repo, "commit", "-m", "v1.0.0"]);
  runGit(["-C", repo, "tag", "v1.0.0"]);

  writeFileSync(join(repo, "skills", "proposal", "SKILL.md"), "# Proposal v1.1.0\nMARKER=v1.1.0\n", "utf8");
  runGit(["-C", repo, "add", "."]);
  runGit(["-C", repo, "commit", "-m", "v1.1.0"]);
  runGit(["-C", repo, "tag", "v1.1.0"]);

  return repo;
}

function writeConfig(path, version) {
  const content = {
    schema_version: "1",
    default_version: "v1.0.0",
    bundles: {
      "developer-bundle": { version },
      "pm-bundle": { version: "v1.0.0" },
      "milk-jawn-bundle": { version: "v1.0.0" },
      "full-bundle": { version: "v1.0.0" }
    },
    updated_at: new Date().toISOString(),
    updated_by: "wp04-verifier@local"
  };

  writeFileSync(path, `${JSON.stringify(content, null, 2)}\n`, "utf8");
}

function parseStatusJson(raw) {
  return JSON.parse(raw);
}

function readMarker(destDir) {
  return readFileSync(join(destDir, "proposal", "SKILL.md"), "utf8")
    .split("\n")
    .find((line) => line.startsWith("MARKER="))
    ?.replace("MARKER=", "") ?? "missing";
}

function markdownFence(text) {
  return ["```text", text.trim() || "(empty)", "```"].join("\n");
}

const root = mkdtempSync(join(tmpdir(), "wp04-pin-"));
const repo = createRepo(root);
const configPath = join(root, "distribution-config.json");
const destDir = join(root, "dest-skills");
const cacheDir = join(root, "cache");
const evidenceDir = "docs/verification/evidence";
const stamp = new Date().toISOString().replace(/[.:]/g, "-");
const evidencePath = join(evidenceDir, `wp04-cli-pin-propagation-${stamp}.md`);

mkdirSync(evidenceDir, { recursive: true });

const env = {
  ...process.env,
  SKILL_SYNC_REPO_URL: repo,
  SKILL_SYNC_BUNDLE: "developer-bundle",
  SKILL_SYNC_DISTRIBUTION_CONFIG: configPath,
  SKILL_SYNC_DEST_DIR: destDir,
  SKILL_SYNC_CACHE_DIR: cacheDir
};

writeConfig(configPath, "v1.0.0");
const beforeSync = run("pnpm", ["exec", "tsx", "packages/skill-sync/src/cli.ts", "--sync", "--quiet"], env);
const beforeStatus = run("pnpm", ["exec", "tsx", "packages/skill-sync/src/cli.ts", "--status"], env);
const beforeVersion = parseStatusJson(beforeStatus.stdout).version;
const beforeMarker = readMarker(destDir);

const pinUpdatedAt = new Date().toISOString();
writeConfig(configPath, "v1.1.0");
const afterSync = run("pnpm", ["exec", "tsx", "packages/skill-sync/src/cli.ts", "--sync", "--quiet"], env);
const afterStatus = run("pnpm", ["exec", "tsx", "packages/skill-sync/src/cli.ts", "--status"], env);
const afterVersion = parseStatusJson(afterStatus.stdout).version;
const afterMarker = readMarker(destDir);

const passed =
  beforeSync.status === 0 &&
  afterSync.status === 0 &&
  beforeVersion === "v1.0.0" &&
  afterVersion === "v1.1.0" &&
  beforeMarker === "v1.0.0" &&
  afterMarker === "v1.1.0";

const report = [
  "# WP04 CLI Pin Propagation Evidence",
  "",
  `- Generated at: ${new Date().toISOString()}`,
  `- Temp root: ${root}`,
  `- Repo: ${repo}`,
  `- Bundle: developer-bundle`,
  `- Config path: ${configPath}`,
  "",
  "## Result",
  "",
  `- Before version: ${beforeVersion}`,
  `- After version: ${afterVersion}`,
  `- Before marker: ${beforeMarker}`,
  `- After marker: ${afterMarker}`,
  `- Restart count to propagate (CLI): 1`,
  `- Pin updated at: ${pinUpdatedAt}`,
  `- After-sync duration (ms): ${afterSync.durationMs}`,
  `- Pass: ${passed ? "yes" : "no"}`,
  "",
  "## Command Output",
  "",
  `### ${beforeSync.command}`,
  markdownFence(beforeSync.stdout || beforeSync.stderr),
  "",
  `### ${beforeStatus.command}`,
  markdownFence(beforeStatus.stdout || beforeStatus.stderr),
  "",
  `### ${afterSync.command}`,
  markdownFence(afterSync.stdout || afterSync.stderr),
  "",
  `### ${afterStatus.command}`,
  markdownFence(afterStatus.stdout || afterStatus.stderr)
].join("\n");

writeFileSync(evidencePath, `${report}\n`, "utf8");
console.log(`Wrote WP04 evidence: ${evidencePath}`);

if (process.argv.includes("--keep-temp") === false) {
  rmSync(root, { recursive: true, force: true });
}

process.exit(passed ? 0 : 1);
