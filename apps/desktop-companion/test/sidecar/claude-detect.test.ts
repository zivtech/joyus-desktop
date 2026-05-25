import { describe, expect, it } from "vitest";
import { detectClaude, createDefaultClaudeDeps } from "../../src/sidecar/claude-detect";
import type { ClaudeDetectDeps } from "../../src/sidecar/claude-detect";

describe("detectClaude", () => {
  it("returns found: true with path and version when claude is on PATH", () => {
    const deps: ClaudeDetectDeps = {
      execCommand: (cmd: string) => {
        if (cmd === "which claude") return "/usr/local/bin/claude\n";
        if (cmd === "claude --version") return "claude-code/1.2.3\n";
        return "";
      },
      fileExists: () => true,
    };

    const result = detectClaude(deps);
    expect(result.found).toBe(true);
    expect(result.path).toBe("/usr/local/bin/claude");
    expect(result.version).toBe("1.2.3");
  });

  it("returns found: true without version when --version throws", () => {
    const deps: ClaudeDetectDeps = {
      execCommand: (cmd: string) => {
        if (cmd === "which claude") return "/usr/local/bin/claude\n";
        throw new Error("command failed");
      },
      fileExists: () => true,
    };

    const result = detectClaude(deps);
    expect(result.found).toBe(true);
    expect(result.path).toBe("/usr/local/bin/claude");
    expect(result.version).toBeUndefined();
  });

  it("returns found: false when which throws", () => {
    const deps: ClaudeDetectDeps = {
      execCommand: () => {
        throw new Error("not found");
      },
      fileExists: () => false,
    };

    const result = detectClaude(deps);
    expect(result.found).toBe(false);
    expect(result.path).toBeUndefined();
  });

  it("returns found: false when which returns empty string", () => {
    const deps: ClaudeDetectDeps = {
      execCommand: () => "",
      fileExists: () => false,
    };

    const result = detectClaude(deps);
    expect(result.found).toBe(false);
  });

  it("returns found: false when which returns a path but fileExists returns false", () => {
    const deps: ClaudeDetectDeps = {
      execCommand: (cmd: string) => {
        if (cmd === "which claude") return "/usr/local/bin/claude\n";
        return "";
      },
      fileExists: () => false,
    };

    const result = detectClaude(deps);
    expect(result.found).toBe(false);
  });

  it("extracts version number from verbose output", () => {
    const deps: ClaudeDetectDeps = {
      execCommand: (cmd: string) => {
        if (cmd === "which claude") return "/opt/bin/claude\n";
        if (cmd === "claude --version") return "Claude Code CLI version 2.0.15-beta\n";
        return "";
      },
      fileExists: () => true,
    };

    const result = detectClaude(deps);
    expect(result.found).toBe(true);
    expect(result.version).toBe("2.0.15");
  });

  it("handles version output with no parseable number", () => {
    const deps: ClaudeDetectDeps = {
      execCommand: (cmd: string) => {
        if (cmd === "which claude") return "/opt/bin/claude\n";
        if (cmd === "claude --version") return "unknown version\n";
        return "";
      },
      fileExists: () => true,
    };

    const result = detectClaude(deps);
    expect(result.found).toBe(true);
    expect(result.version).toBeUndefined();
  });
});

describe("createDefaultClaudeDeps", () => {
  it("returns an object with execCommand and fileExists functions", () => {
    const deps = createDefaultClaudeDeps();
    expect(typeof deps.execCommand).toBe("function");
    expect(typeof deps.fileExists).toBe("function");
  });

  it("fileExists returns false for a non-existent path", () => {
    const deps = createDefaultClaudeDeps();
    expect(deps.fileExists("/this/path/does/not/exist/at/all")).toBe(false);
  });

  it("execCommand returns string output for a valid command", () => {
    const deps = createDefaultClaudeDeps();
    const result = deps.execCommand("echo hello");
    expect(typeof result).toBe("string");
  });
});
