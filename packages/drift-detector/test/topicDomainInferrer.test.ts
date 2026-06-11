import { describe, expect, it } from "vitest";
import { inferTopicDomain, TopicDomainInferrer } from "../src/index.js";

describe("inferTopicDomain", () => {
  it("maps components path to frontend", () => {
    expect(inferTopicDomain("src/components/Button.tsx")).toBe("frontend");
  });

  it("maps api path to backend", () => {
    expect(inferTopicDomain("api/routes/users.ts")).toBe("backend");
  });

  it("returns other for unknown paths", () => {
    expect(inferTopicDomain("unknown/mystery.xyz")).toBe("other");
  });

  it("is case-insensitive", () => {
    expect(inferTopicDomain("SRC/COMPONENTS/Button.tsx")).toBe("frontend");
    expect(inferTopicDomain("API/Routes/users.ts")).toBe("backend");
  });

  it("maps ui segment to frontend", () => {
    expect(inferTopicDomain("ui/layout/Header.tsx")).toBe("frontend");
  });

  it("maps pages segment to frontend", () => {
    expect(inferTopicDomain("pages/home.tsx")).toBe("frontend");
  });

  it("maps test segment to testing", () => {
    expect(inferTopicDomain("test/unit/foo.test.ts")).toBe("testing");
  });

  it("maps spec segment to testing", () => {
    expect(inferTopicDomain("spec/integration/bar.ts")).toBe("testing");
  });

  it("maps __tests__ segment to testing", () => {
    expect(inferTopicDomain("src/__tests__/baz.ts")).toBe("testing");
  });

  it("maps docs segment to documentation", () => {
    expect(inferTopicDomain("docs/api-reference.md")).toBe("documentation");
  });

  it("maps config segment to configuration", () => {
    expect(inferTopicDomain("config/settings.json")).toBe("configuration");
  });

  it("maps schema segment to data", () => {
    expect(inferTopicDomain("schema/migrations/001.sql")).toBe("data");
  });

  it("maps scripts segment to tooling", () => {
    expect(inferTopicDomain("scripts/build.sh")).toBe("tooling");
  });

  it("maps auth segment to security", () => {
    expect(inferTopicDomain("auth/middleware/verify.ts")).toBe("security");
  });

  it("maps services segment to backend", () => {
    expect(inferTopicDomain("services/userService.ts")).toBe("backend");
  });

  it("maps css extension to frontend via extension fallback", () => {
    // Path with no matching segment keyword but .css extension
    expect(inferTopicDomain("assets/global.css")).toBe("frontend");
  });

  it("returns other for empty-ish path with no match", () => {
    expect(inferTopicDomain("random/totally/unknown/file.xyz")).toBe("other");
  });

  it("first segment match wins", () => {
    // 'api' appears first, should win over 'test' in a later segment
    expect(inferTopicDomain("api/test/foo.ts")).toBe("backend");
  });

  it("handles paths with no segments gracefully", () => {
    expect(inferTopicDomain("")).toBe("other");
  });
});

describe("TopicDomainInferrer class", () => {
  it("infer delegates to inferTopicDomain", () => {
    const inferrer = new TopicDomainInferrer();
    expect(inferrer.infer("src/components/Button.tsx")).toBe("frontend");
    expect(inferrer.infer("unknown/mystery.xyz")).toBe("other");
  });
});
