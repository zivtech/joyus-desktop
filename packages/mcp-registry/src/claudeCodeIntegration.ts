import type { ManagedMcpEntry } from "./types";

export interface McpConfigJson {
  mcpServers?: Record<string, Record<string, unknown>>;
}

export interface ClaudeCodeDeps {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, data: string) => Promise<void>;
  copyFile: (src: string, dest: string) => Promise<void>;
}

export function mergeMcpConfig(
  existing: McpConfigJson,
  managedEntries: Record<string, ManagedMcpEntry>,
): McpConfigJson {
  const current = existing.mcpServers ?? {};

  // Keep all non-managed entries
  const preserved: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(current)) {
    const entry = value as Record<string, unknown>;
    if (entry["_managed_by"] !== "joyus-desktop") {
      preserved[key] = entry;
    }
  }

  // Merge managed entries
  const merged: Record<string, Record<string, unknown>> = {
    ...preserved,
    ...managedEntries,
  };

  return { mcpServers: merged };
}

export function removeManagedEntries(existing: McpConfigJson): McpConfigJson {
  const current = existing.mcpServers ?? {};
  const filtered: Record<string, Record<string, unknown>> = {};

  for (const [key, value] of Object.entries(current)) {
    const entry = value as Record<string, unknown>;
    if (entry["_managed_by"] !== "joyus-desktop") {
      filtered[key] = entry;
    }
  }

  return { mcpServers: filtered };
}

async function safeReadConfig(filePath: string, deps: ClaudeCodeDeps): Promise<McpConfigJson> {
  try {
    const raw = await deps.readFile(filePath);
    if (raw.trim() === "") {
      return { mcpServers: {} };
    }
    return JSON.parse(raw) as McpConfigJson;
  } catch (error) {
    const isParseError =
      error instanceof SyntaxError ||
      (error instanceof Error && error.message.includes("JSON"));

    if (isParseError) {
      // Backup malformed file
      await deps.copyFile(filePath, `${filePath}.backup`);
      return { mcpServers: {} };
    }

    // File not found — start fresh
    return { mcpServers: {} };
  }
}

export async function writeMcpConfig(
  filePath: string,
  entries: Record<string, ManagedMcpEntry>,
  deps: ClaudeCodeDeps,
): Promise<void> {
  const existing = await safeReadConfig(filePath, deps);
  const merged = mergeMcpConfig(existing, entries);
  await deps.writeFile(filePath, JSON.stringify(merged, null, 2));
}

export async function removeMcpConfig(
  filePath: string,
  deps: ClaudeCodeDeps,
): Promise<void> {
  const existing = await safeReadConfig(filePath, deps);
  const cleaned = removeManagedEntries(existing);
  await deps.writeFile(filePath, JSON.stringify(cleaned, null, 2));
}
