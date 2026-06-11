export type ServerStatus = "stopped" | "starting" | "running" | "error";

export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface McpServerInfo {
  name: string;
  config: McpServerConfig;
  status: ServerStatus;
  pid?: number;
  version?: string;
  enabled: boolean;
  restartCount: number;
  lastError?: string;
}

export interface ServerManifest {
  servers: Record<
    string,
    { command: string; args: string[]; enabled: boolean; version?: string }
  >;
}

export interface PidFileEntry {
  name: string;
  pid: number;
  startedAt: string;
}

export interface ManagedMcpEntry {
  command: string;
  args: string[];
  _managed_by: "joyus-desktop";
  _version: string;
}
