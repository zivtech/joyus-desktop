import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

export interface ChromeDetectResult {
  available: boolean;
  path?: string;
  version?: string;
}

export interface ChromeDetectDeps {
  platform: string;
  fileExists: (path: string) => boolean;
  execFile: (command: string, args: string[]) => string;
}

const CHROME_PATHS: Record<string, string[]> = {
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ],
};

export function detectChrome(deps: ChromeDetectDeps): ChromeDetectResult {
  const paths = CHROME_PATHS[deps.platform] ?? [];

  for (const chromePath of paths) {
    if (deps.fileExists(chromePath)) {
      let version: string | undefined;
      try {
        const raw = deps.execFile(chromePath, ["--version"]).trim();
        // Output format: "Google Chrome 120.0.6099.109" or "Chromium 120.0.6099.109"
        const match = /[\d]+\.[\d.]+/.exec(raw);
        version = match?.[0];
      } catch {
        // version stays undefined if we can't run chrome
      }
      return { available: true, path: chromePath, ...(version !== undefined && { version }) };
    }
  }

  return { available: false };
}

export function createDefaultChromeDeps(): ChromeDetectDeps {
  return {
    platform: process.platform,
    fileExists: existsSync,
    execFile: (command: string, args: string[]) =>
      execFileSync(command, args, { encoding: "utf8" }),
  };
}
