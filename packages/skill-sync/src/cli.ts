import { join } from "node:path";
import { readSyncMetadata } from "./metadata";
import { resolveHomePath, syncSkills } from "./sync";
import { resolvePinnedVersion } from "./distributionConfig";

export interface CliDependencies {
  sync: typeof syncSkills;
  readMetadata: typeof readSyncMetadata;
  stdout: Pick<Console, "log">;
  stderr: Pick<Console, "error">;
}

export interface CliOptions {
  action: "sync" | "status" | "help";
  repoUrl?: string;
  targetVersion?: string;
  bundleName?: string;
  distributionConfig?: string;
  distributionConfigUrl?: string;
  destDir?: string;
  cacheDir?: string;
  metadataPath?: string;
  pinFile?: string;
  quiet: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    action: "sync",
    quiet: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];

    if (value === "--help" || value === "-h") {
      options.action = "help";
      continue;
    }

    if (value === "--status") {
      options.action = "status";
      continue;
    }

    if (value === "--sync") {
      options.action = "sync";
      continue;
    }

    if (value === "--quiet") {
      options.quiet = true;
      continue;
    }

    const next = args[index + 1];
    if (value === "--repo-url") {
      if (next !== undefined) {
        options.repoUrl = next;
      }
      index += 1;
      continue;
    }

    if (value === "--version") {
      if (next !== undefined) {
        options.targetVersion = next;
      }
      index += 1;
      continue;
    }

    if (value === "--dest-dir") {
      if (next !== undefined) {
        options.destDir = next;
      }
      index += 1;
      continue;
    }

    if (value === "--bundle") {
      if (next !== undefined) {
        options.bundleName = next;
      }
      index += 1;
      continue;
    }

    if (value === "--distribution-config") {
      if (next !== undefined) {
        options.distributionConfig = next;
      }
      index += 1;
      continue;
    }

    if (value === "--distribution-config-url") {
      if (next !== undefined) {
        options.distributionConfigUrl = next;
      }
      index += 1;
      continue;
    }

    if (value === "--cache-dir") {
      if (next !== undefined) {
        options.cacheDir = next;
      }
      index += 1;
      continue;
    }

    if (value === "--metadata") {
      if (next !== undefined) {
        options.metadataPath = next;
      }
      index += 1;
      continue;
    }

    if (value === "--pin-file") {
      if (next !== undefined) {
        options.pinFile = next;
      }
      index += 1;
    }
  }

  return options;
}

function usage(): string {
  return [
    "skill-sync usage:",
    "  skill-sync --sync [--repo-url <url>] [--version <tag>] [--bundle <bundle>] [--distribution-config <path>] [--distribution-config-url <url>] [--dest-dir <path>] [--cache-dir <path>] [--quiet]",
    "  skill-sync --status [--dest-dir <path>] [--metadata <path>]",
    "",
    "Env fallbacks:",
    "  SKILL_SYNC_REPO_URL",
    "  SKILL_SYNC_TARGET_VERSION",
    "  SKILL_SYNC_BUNDLE",
    "  SKILL_SYNC_DISTRIBUTION_CONFIG",
    "  SKILL_SYNC_DISTRIBUTION_CONFIG_URL",
    "  SKILL_SYNC_DEST_DIR",
    "  SKILL_SYNC_CACHE_DIR"
  ].join("\n");
}

export async function runCli(
  argv: string[],
  deps: CliDependencies
): Promise<number> {
  const options = parseArgs(argv);

  if (options.action === "help") {
    deps.stdout.log(usage());
    return 0;
  }

  const destDir = resolveHomePath(options.destDir ?? process.env.SKILL_SYNC_DEST_DIR ?? "~/.claude/skills");
  const metadataPath = resolveHomePath(options.metadataPath ?? join(destDir, ".sync-metadata.json"));

  if (options.action === "status") {
    const metadata = await deps.readMetadata(metadataPath);
    deps.stdout.log(JSON.stringify(metadata ?? { status: "unknown" }, null, 2));
    return 0;
  }

  const repoUrl = options.repoUrl ?? process.env.SKILL_SYNC_REPO_URL;
  const explicitTargetVersion = options.targetVersion ?? process.env.SKILL_SYNC_TARGET_VERSION;
  const bundleName = options.bundleName ?? process.env.SKILL_SYNC_BUNDLE;
  const distributionConfig = options.distributionConfig ?? options.pinFile ?? process.env.SKILL_SYNC_DISTRIBUTION_CONFIG;
  const distributionConfigUrl = options.distributionConfigUrl ?? process.env.SKILL_SYNC_DISTRIBUTION_CONFIG_URL;
  const cacheDir = resolveHomePath(options.cacheDir ?? process.env.SKILL_SYNC_CACHE_DIR ?? "~/.claude/.skill-sync-cache");

  if (!repoUrl) {
    deps.stderr.error("Missing required sync config: repo URL is required.");
    deps.stderr.error("Set --repo-url or SKILL_SYNC_REPO_URL.");
    return 1;
  }

  try {
    const resolvedTargetVersion = explicitTargetVersion ?? (
      await resolvePinnedVersion({
        bundleName,
        configPath: distributionConfig,
        configUrl: distributionConfigUrl
      })
    ).version;

    const result = await deps.sync({
      repoUrl,
      targetVersion: resolvedTargetVersion,
      destDir,
      cacheDir,
      metadataPath
    });

    if (!options.quiet) {
      deps.stdout.log(JSON.stringify(result, null, 2));
    }

    return 0;
  } catch (error) {
    deps.stderr.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/* v8 ignore start */
if (import.meta.url === `file://${process.argv[1]}`) {
  const exitCode = await runCli(process.argv.slice(2), {
    sync: syncSkills,
    readMetadata: readSyncMetadata,
    stdout: console,
    stderr: console
  });

  process.exitCode = exitCode;
}
/* v8 ignore end */
