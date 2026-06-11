#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function parseArgs(argv) {
  const options = {
    hookPath: join(homedir(), ".claude", "hooks.json"),
    command: `pnpm exec tsx ${join(repoRoot, "packages", "skill-sync", "src", "cli.ts")} --sync --quiet`,
    dryRun: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    const next = argv[i + 1];

    if (value === "--hook-path" && next) {
      options.hookPath = next;
      i += 1;
      continue;
    }

    if (value === "--command" && next) {
      options.command = next;
      i += 1;
      continue;
    }

    if (value === "--dry-run") {
      options.dryRun = true;
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
    "  node scripts/skill-sync/install-hook.mjs [--hook-path <path>] [--command <cmd>] [--dry-run]",
    "",
    "Default hook path:",
    "  ~/.claude/hooks.json"
  ].join("\n");
}

function backupPath(path) {
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  return `${path}.bak.${stamp}`;
}

function mergeHook(existing, command) {
  const root = existing && typeof existing === "object" ? existing : {};
  if (!root.hooks || typeof root.hooks !== "object") {
    root.hooks = {};
  }

  const sessionStart = root.hooks.session_start;
  const desired = {
    command,
    timeout_ms: 10000,
    async: true
  };

  if (!sessionStart) {
    root.hooks.session_start = desired;
    return root;
  }

  if (Array.isArray(sessionStart)) {
    const withoutOld = sessionStart.filter(
      (item) => !(item && typeof item === "object" && item.command === command)
    );
    withoutOld.push(desired);
    root.hooks.session_start = withoutOld;
    return root;
  }

  root.hooks.session_start = desired;
  return root;
}

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  console.log(usage());
  process.exit(0);
}

let parsed = {};
if (existsSync(options.hookPath)) {
  const raw = readFileSync(options.hookPath, "utf8");
  parsed = JSON.parse(raw);
}

const next = mergeHook(parsed, options.command);
const rendered = `${JSON.stringify(next, null, 2)}\n`;

if (options.dryRun) {
  console.log(rendered);
  process.exit(0);
}

mkdirSync(dirname(options.hookPath), { recursive: true });
if (existsSync(options.hookPath)) {
  const backup = backupPath(options.hookPath);
  writeFileSync(backup, readFileSync(options.hookPath, "utf8"), "utf8");
  console.log(`Created backup: ${backup}`);
}

writeFileSync(options.hookPath, rendered, "utf8");
console.log(`Installed skill-sync session_start hook at ${options.hookPath}`);
