import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

export interface ClaudeDetectResult {
  found: boolean;
  path?: string;
  version?: string;
}

export interface ClaudeDetectDeps {
  execFile: (command: string, args: string[]) => string;
  fileExists: (path: string) => boolean;
}

export function detectClaude(deps: ClaudeDetectDeps): ClaudeDetectResult {
  let whichPath: string | undefined;
  try {
    whichPath = deps.execFile("which", ["claude"]).trim();
  } catch {
    return { found: false };
  }

  if (!whichPath || !deps.fileExists(whichPath)) {
    return { found: false };
  }

  let version: string | undefined;
  try {
    const raw = deps.execFile(whichPath, ["--version"]).trim();
    const match = /[\d]+\.[\d.]+/.exec(raw);
    version = match?.[0];
  } catch {
    // version stays undefined if we can't run claude
  }

  const result: ClaudeDetectResult = { found: true, path: whichPath };
  if (version !== undefined) {
    result.version = version;
  }
  return result;
}

export function createDefaultClaudeDeps(): ClaudeDetectDeps {
  return {
    execFile: (command: string, args: string[]) =>
      execFileSync(command, args, { encoding: "utf8" }),
    fileExists: existsSync,
  };
}
