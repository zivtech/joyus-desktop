import type { ProcessManager } from "./processManager";
import type { McpServerConfig, McpServerInfo, ServerManifest, ServerStatus } from "./types";

export interface RegistryDeps {
  processManager: ProcessManager;
}

export interface Registry {
  registerServer: (name: string, config: McpServerConfig & { version?: string }) => void;
  unregisterServer: (name: string) => void;
  startServer: (name: string) => McpServerInfo;
  stopServer: (name: string) => Promise<McpServerInfo>;
  restartServer: (name: string) => Promise<McpServerInfo>;
  getStatus: (name: string) => ServerStatus;
  listServers: () => McpServerInfo[];
  startAll: () => McpServerInfo[];
  stopAll: () => Promise<McpServerInfo[]>;
}

interface ServerRecord {
  config: McpServerConfig;
  version?: string;
  enabled: boolean;
}

export function createRegistry(manifest: ServerManifest, deps: RegistryDeps): Registry {
  const servers = new Map<string, ServerRecord>();

  // Initialize from manifest
  for (const [name, entry] of Object.entries(manifest.servers)) {
    servers.set(name, {
      config: { command: entry.command, args: entry.args },
      ...(entry.version !== undefined && { version: entry.version }),
      enabled: entry.enabled,
    });
  }

  function buildInfo(name: string): McpServerInfo {
    const record = servers.get(name);
    if (!record) {
      throw new Error(`Server "${name}" is not registered`);
    }

    const processEntry = deps.processManager.getEntry(name);
    const isRunning = deps.processManager.isRunning(name);

    let status: ServerStatus;
    if (processEntry?.lastError) {
      status = "error";
    } else if (isRunning) {
      status = "running";
    } else {
      status = "stopped";
    }

    return {
      name,
      config: record.config,
      status,
      ...(processEntry !== undefined && { pid: processEntry.child.pid }),
      ...(record.version !== undefined && { version: record.version }),
      enabled: record.enabled,
      restartCount: processEntry?.restartCount ?? 0,
      ...(processEntry?.lastError !== undefined && { lastError: processEntry.lastError }),
    };
  }

  function registerServer(name: string, config: McpServerConfig & { version?: string }): void {
    if (servers.has(name)) {
      throw new Error(`Server "${name}" is already registered`);
    }
    servers.set(name, {
      config: { command: config.command, args: config.args, ...(config.env !== undefined && { env: config.env }) },
      ...(config.version !== undefined && { version: config.version }),
      enabled: true,
    });
  }

  function unregisterServer(name: string): void {
    if (!servers.has(name)) {
      throw new Error(`Server "${name}" is not registered`);
    }
    if (deps.processManager.isRunning(name)) {
      throw new Error(`Server "${name}" is still running; stop it first`);
    }
    servers.delete(name);
  }

  function startServer(name: string): McpServerInfo {
    const record = servers.get(name);
    if (!record) {
      throw new Error(`Server "${name}" is not registered`);
    }
    if (deps.processManager.isRunning(name)) {
      throw new Error(`Server "${name}" is already running`);
    }

    deps.processManager.spawnServer(name, record.config);
    return buildInfo(name);
  }

  async function stopServer(name: string): Promise<McpServerInfo> {
    const record = servers.get(name);
    if (!record) {
      throw new Error(`Server "${name}" is not registered`);
    }

    await deps.processManager.stopServer(name);
    return buildInfo(name);
  }

  async function restartServer(name: string): Promise<McpServerInfo> {
    const record = servers.get(name);
    if (!record) {
      throw new Error(`Server "${name}" is not registered`);
    }

    if (deps.processManager.isRunning(name)) {
      await deps.processManager.stopServer(name);
    }

    deps.processManager.spawnServer(name, record.config);
    return buildInfo(name);
  }

  function getStatus(name: string): ServerStatus {
    return buildInfo(name).status;
  }

  function listServers(): McpServerInfo[] {
    return [...servers.keys()].map((n) => buildInfo(n));
  }

  function startAll(): McpServerInfo[] {
    const results: McpServerInfo[] = [];
    for (const [name, record] of servers) {
      if (record.enabled && !deps.processManager.isRunning(name)) {
        deps.processManager.spawnServer(name, record.config);
      }
      results.push(buildInfo(name));
    }
    return results;
  }

  async function stopAll(): Promise<McpServerInfo[]> {
    await deps.processManager.stopAll();
    return [...servers.keys()].map((n) => buildInfo(n));
  }

  return {
    registerServer,
    unregisterServer,
    startServer,
    stopServer,
    restartServer,
    getStatus,
    listServers,
    startAll,
    stopAll,
  };
}
