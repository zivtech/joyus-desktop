import type { McpServerConfig, PidFileEntry } from "./types";

export interface ChildHandle {
  pid: number;
  kill: (signal: string) => void;
  on: (event: string, cb: (code: number | null) => void) => void;
}

export interface SpawnFn {
  (
    command: string,
    args: string[],
    options: { env?: Record<string, string>; stdio?: string; detached?: boolean },
  ): ChildHandle;
}

export interface KillFn {
  (pid: number, signal: string): boolean;
}

export interface ProcessManagerDeps {
  spawn: SpawnFn;
  kill: KillFn;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, data: string) => Promise<void>;
  processExists: (pid: number) => boolean;
  setTimeout: (cb: () => void, ms: number) => ReturnType<typeof globalThis.setTimeout>;
  clearTimeout: (id: ReturnType<typeof globalThis.setTimeout>) => void;
  setInterval: (cb: () => void, ms: number) => ReturnType<typeof globalThis.setInterval>;
  clearInterval: (id: ReturnType<typeof globalThis.setInterval>) => void;
}

export interface ProcessEntry {
  child: ChildHandle;
  name: string;
  config: McpServerConfig;
  restartCount: number;
  lastError?: string;
}

export interface ProcessManager {
  spawnServer: (name: string, config: McpServerConfig) => number;
  stopServer: (name: string) => Promise<boolean>;
  stopAll: () => Promise<void>;
  isRunning: (name: string) => boolean;
  getEntry: (name: string) => ProcessEntry | undefined;
  writePidFile: (entries: PidFileEntry[], path: string) => Promise<void>;
  readPidFile: (path: string) => Promise<PidFileEntry[]>;
  cleanupOrphans: (pidFilePath: string) => Promise<number>;
  startWatchdog: (
    interval: number,
    maxRestarts: number,
    onRestart: (name: string, config: McpServerConfig) => void,
  ) => void;
  stopWatchdog: () => void;
}

export function createProcessManager(deps: ProcessManagerDeps): ProcessManager {
  const processes = new Map<string, ProcessEntry>();
  let watchdogId: ReturnType<typeof globalThis.setInterval> | undefined;

  function spawnServer(name: string, config: McpServerConfig): number {
    const existing = processes.get(name);
    if (existing) {
      throw new Error(`Server "${name}" is already running`);
    }

    const child = deps.spawn(config.command, config.args, {
      ...(config.env !== undefined && { env: config.env }),
      stdio: "pipe",
      detached: true,
    });

    const entry: ProcessEntry = {
      child,
      name,
      config,
      restartCount: 0,
    };

    child.on("exit", () => {
      const current = processes.get(name);
      if (current?.child === child) {
        processes.delete(name);
      }
    });

    processes.set(name, entry);
    return child.pid;
  }

  async function stopServer(name: string): Promise<boolean> {
    const entry = processes.get(name);
    if (!entry) {
      return false;
    }

    entry.child.kill("SIGTERM");

    const stopped = await new Promise<boolean>((resolve) => {
      let resolved = false;
      const timeout = deps.setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      }, 5000);

      let checkInterval: ReturnType<typeof globalThis.setInterval>;
      checkInterval = deps.setInterval(() => {
        if (!deps.processExists(entry.child.pid)) {
          if (!resolved) {
            resolved = true;
            deps.clearTimeout(timeout);
            deps.clearInterval(checkInterval);
            resolve(true);
          }
        }
      }, 100);

      // Also clear interval on timeout
      deps.setTimeout(() => {
        deps.clearInterval(checkInterval);
      }, 5100);
    });

    if (!stopped) {
      deps.kill(entry.child.pid, "SIGKILL");
    }

    processes.delete(name);
    return true;
  }

  async function stopAll(): Promise<void> {
    const names = [...processes.keys()];
    await Promise.all(names.map((n) => stopServer(n)));
  }

  function isRunning(name: string): boolean {
    return processes.has(name);
  }

  function getEntry(name: string): ProcessEntry | undefined {
    return processes.get(name);
  }

  async function writePidFile(entries: PidFileEntry[], path: string): Promise<void> {
    await deps.writeFile(path, JSON.stringify(entries, null, 2));
  }

  async function readPidFile(path: string): Promise<PidFileEntry[]> {
    try {
      const data = await deps.readFile(path);
      return JSON.parse(data) as PidFileEntry[];
    } catch {
      return [];
    }
  }

  async function cleanupOrphans(pidFilePath: string): Promise<number> {
    const entries = await readPidFile(pidFilePath);
    let killed = 0;

    for (const entry of entries) {
      if (deps.processExists(entry.pid)) {
        deps.kill(entry.pid, "SIGTERM");
        killed++;
      }
    }

    if (entries.length > 0) {
      await writePidFile([], pidFilePath);
    }

    return killed;
  }

  function startWatchdog(
    interval: number,
    maxRestarts: number,
    onRestart: (name: string, config: McpServerConfig) => void,
  ): void {
    if (watchdogId !== undefined) {
      deps.clearInterval(watchdogId);
    }

    watchdogId = deps.setInterval(() => {
      for (const [name, entry] of processes) {
        if (!deps.processExists(entry.child.pid)) {
          if (entry.restartCount < maxRestarts) {
            entry.restartCount++;
            processes.delete(name);
            onRestart(name, entry.config);
          } else {
            entry.lastError = `Max restarts (${maxRestarts}) exceeded`;
            processes.delete(name);
          }
        }
      }
    }, interval);
  }

  function stopWatchdog(): void {
    if (watchdogId !== undefined) {
      deps.clearInterval(watchdogId);
      watchdogId = undefined;
    }
  }

  return {
    spawnServer,
    stopServer,
    stopAll,
    isRunning,
    getEntry,
    writePidFile,
    readPidFile,
    cleanupOrphans,
    startWatchdog,
    stopWatchdog,
  };
}
