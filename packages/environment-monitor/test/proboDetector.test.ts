import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createProboDetector } from "../src/proboDetector";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `probo-detector-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("createProboDetector", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns false when no .probo file exists", () => {
    const detector = createProboDetector();
    expect(detector.hasProbo(tmpDir)).toBe(false);
  });

  it("returns true when .probo.yaml exists", () => {
    writeFileSync(join(tmpDir, ".probo.yaml"), "version: 0.13.0\n");
    const detector = createProboDetector();
    expect(detector.hasProbo(tmpDir)).toBe(true);
  });

  it("returns true when .probo.yml exists", () => {
    writeFileSync(join(tmpDir, ".probo.yml"), "version: 0.13.0\n");
    const detector = createProboDetector();
    expect(detector.hasProbo(tmpDir)).toBe(true);
  });

  it("returns true when both .probo.yaml and .probo.yml exist", () => {
    writeFileSync(join(tmpDir, ".probo.yaml"), "version: 0.13.0\n");
    writeFileSync(join(tmpDir, ".probo.yml"), "version: 0.13.0\n");
    const detector = createProboDetector();
    expect(detector.hasProbo(tmpDir)).toBe(true);
  });

  it("returns false for a non-existent directory", () => {
    const detector = createProboDetector();
    expect(detector.hasProbo(join(tmpDir, "does-not-exist"))).toBe(false);
  });

  it("only matches .probo.yaml and .probo.yml — not other names", () => {
    writeFileSync(join(tmpDir, "probo.yaml"), "version: 0.13.0\n");
    writeFileSync(join(tmpDir, ".probo.json"), "{}");
    const detector = createProboDetector();
    expect(detector.hasProbo(tmpDir)).toBe(false);
  });
});
