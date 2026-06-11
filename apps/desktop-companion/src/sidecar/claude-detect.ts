import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

export interface ClaudeDetectResult {
  found: boolean;
  path?: string;
  version?: string;
}

export interface ClaudeDetectDeps {
  execCommand: (cmd: string) => string;
  fileExists: (path: string) => boolean;
}

export function detectClaude(deps: ClaudeDetectDeps): ClaudeDetectResult {
  let whichPath: string | undefined;
  try {
    whichPath = deps.execCommand("which claude").trim();
  } catch {
    return { found: false };
  }

  if (!whichPath || !deps.fileExists(whichPath)) {
    return { found: false };
  }

  let version: string | undefined;
  try {
    const raw = deps.execCommand("claude --version").trim();
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
    execCommand: (cmd: string) => execSync(cmd, { encoding: "utf8" }),
    fileExists: existsSync,
  };
}
