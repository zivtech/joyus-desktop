// Composition root for the bundled sidecar: wires real process, filesystem,
// and package implementations into startSidecar. Excluded from coverage;
// all behavior lives in the modules it wires together.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import {
  createProcessManager,
  createRegistry,
  type ChildHandle,
  type ServerManifest,
} from "@joyus/mcp-registry";
import { createConfigPoller, isOptedOut } from "@joyus/mcp-governance";
import { startSidecar } from "./main";

const joyusDir = join(homedir(), ".joyus");
const manifestPath = join(joyusDir, "servers.json");

function log(level: "info" | "warn" | "error", message: string): void {
  process.stderr.write(`[${level}] ${message}\n`);
}

function readManifest(): ServerManifest {
  if (!existsSync(manifestPath)) return { servers: {} };
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8")) as ServerManifest;
  } catch (err: unknown) {
    log("warn", `Ignoring unreadable ${manifestPath}: ${String(err)}`);
    return { servers: {} };
  }
}

function spawnChild(
  command: string,
  args: string[],
  options: { env?: Record<string, string>; stdio?: string; detached?: boolean },
): ChildHandle {
  const child = spawn(command, args, {
    env: { ...process.env, ...options.env },
    stdio: (options.stdio ?? "pipe") as "pipe",
    detached: options.detached ?? false,
  });
  return {
    pid: child.pid ?? -1,
    kill: (signal) => {
      child.kill(signal as NodeJS.Signals);
    },
    on: (event, cb) => {
      child.on(event, cb);
    },
  };
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

await mkdir(joyusDir, { recursive: true });

startSidecar({
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  exit: (code) => process.exit(code),
  onSignal: (signal, handler) => {
    process.on(signal, handler);
  },
  onUncaughtException: (handler) => {
    process.on("uncaughtException", handler);
  },
  onUnhandledRejection: (handler) => {
    process.on("unhandledRejection", handler);
  },
  nowFn: () => Date.now(),
  isOptedOut: () => isOptedOut(process.env),
  // No telemetry endpoint is configured for the companion yet.
  emitTelemetry: async () => {},
  serviceDeps: {
    createProcessManager: () =>
      createProcessManager({
        spawn: spawnChild,
        kill: (pid, signal) => {
          try {
            return process.kill(pid, signal as NodeJS.Signals);
          } catch {
            return false;
          }
        },
        readFile: (path) => readFile(path, "utf8"),
        writeFile: (path, data) => writeFile(path, data, "utf8"),
        processExists,
        setTimeout: (cb, ms) => setTimeout(cb, ms),
        clearTimeout: (id) => clearTimeout(id),
        setInterval: (cb, ms) => setInterval(cb, ms),
        clearInterval: (id) => clearInterval(id),
      }),
    createRegistry: (processManager) =>
      createRegistry(readManifest(), { processManager }),
    createConfigPoller: (configPath, intervalMs) =>
      createConfigPoller(
        isAbsolute(configPath) ? configPath : join(joyusDir, configPath),
        intervalMs,
        { log, fs: { readFile: (path) => readFile(path, "utf8") } },
      ),
    // Skill sync needs a distribution repo that is not configured yet;
    // report idle rather than failing startup, and tell onboarding to skip it.
    isSyncConfigured: () => false,
    createPeriodicSync: () => ({
      start: () => {},
      stop: () => {},
      getStatus: () => "idle",
    }),
  },
});
