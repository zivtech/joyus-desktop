import { describe, it, expect, vi } from "vitest";

import { createUserIdentity } from "../src/userIdentity.js";
import type { ExecCommand } from "../../local-provisioner/src/runtimeDetector.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeExec(
  responses: Record<string, { stdout: string; stderr: string } | Error>,
): ExecCommand {
  return vi.fn().mockImplementation((args: readonly string[]) => {
    const key = args.join(" ");
    const response = responses[key];
    if (response instanceof Error) return Promise.reject(response);
    if (response !== undefined) return Promise.resolve(response);
    return Promise.reject(new Error(`Unexpected command: ${key}`));
  });
}

function orgsResponse(logins: string[]): { stdout: string; stderr: string } {
  return {
    stdout: JSON.stringify(logins.map((login) => ({ login }))),
    stderr: "",
  };
}

function userResponse(email: string | undefined): { stdout: string; stderr: string } {
  const user = email !== undefined ? { email } : {};
  return { stdout: JSON.stringify(user), stderr: "" };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createUserIdentity", () => {
  describe("getUserType() — GitHub org membership", () => {
    it("returns 'internal' when user is a member of zivtech org", async () => {
      const exec = makeExec({
        "gh api /user/orgs": orgsResponse(["zivtech", "other-org"]),
        "gh api /user": userResponse(undefined),
      });
      const identity = createUserIdentity({ execCommand: exec });
      expect(await identity.getUserType()).toBe("internal");
    });

    it("returns 'client' when user is not in zivtech org", async () => {
      const exec = makeExec({
        "gh api /user/orgs": orgsResponse(["some-other-org"]),
        "gh api /user": userResponse(undefined),
      });
      const identity = createUserIdentity({ execCommand: exec });
      expect(await identity.getUserType()).toBe("client");
    });

    it("returns 'client' when org list is empty", async () => {
      const exec = makeExec({
        "gh api /user/orgs": orgsResponse([]),
        "gh api /user": userResponse(undefined),
      });
      const identity = createUserIdentity({ execCommand: exec });
      expect(await identity.getUserType()).toBe("client");
    });

    it("org name comparison is case-insensitive", async () => {
      const exec = makeExec({
        "gh api /user/orgs": orgsResponse(["Zivtech"]),
        "gh api /user": userResponse(undefined),
      });
      const identity = createUserIdentity({ execCommand: exec });
      expect(await identity.getUserType()).toBe("internal");
    });

    it("handles gh api /user/orgs failure gracefully — falls through to domain check", async () => {
      const exec = makeExec({
        "gh api /user/orgs": new Error("gh not authenticated"),
        "gh api /user": userResponse("user@zivtech.com"),
      });
      const identity = createUserIdentity({ execCommand: exec });
      expect(await identity.getUserType()).toBe("internal");
    });

    it("uses custom org name when provided", async () => {
      const exec = makeExec({
        "gh api /user/orgs": orgsResponse(["custom-org"]),
        "gh api /user": userResponse(undefined),
      });
      const identity = createUserIdentity({
        execCommand: exec,
        zivtechOrg: "custom-org",
      });
      expect(await identity.getUserType()).toBe("internal");
    });
  });

  describe("getUserType() — Google domain check", () => {
    it("returns 'internal' when user email is @zivtech.com", async () => {
      const exec = makeExec({
        "gh api /user/orgs": orgsResponse([]),
        "gh api /user": userResponse("alex@zivtech.com"),
      });
      const identity = createUserIdentity({ execCommand: exec });
      expect(await identity.getUserType()).toBe("internal");
    });

    it("returns 'client' when user email is a different domain", async () => {
      const exec = makeExec({
        "gh api /user/orgs": orgsResponse([]),
        "gh api /user": userResponse("user@gmail.com"),
      });
      const identity = createUserIdentity({ execCommand: exec });
      expect(await identity.getUserType()).toBe("client");
    });

    it("email comparison is case-insensitive", async () => {
      const exec = makeExec({
        "gh api /user/orgs": orgsResponse([]),
        "gh api /user": userResponse("Alex@ZIVTECH.COM"),
      });
      const identity = createUserIdentity({ execCommand: exec });
      expect(await identity.getUserType()).toBe("internal");
    });

    it("returns 'client' when gh api /user returns no email field", async () => {
      const exec = makeExec({
        "gh api /user/orgs": orgsResponse([]),
        "gh api /user": userResponse(undefined),
      });
      const identity = createUserIdentity({ execCommand: exec });
      expect(await identity.getUserType()).toBe("client");
    });

    it("handles gh api /user failure gracefully — defaults to client", async () => {
      const exec = makeExec({
        "gh api /user/orgs": orgsResponse([]),
        "gh api /user": new Error("network error"),
      });
      const identity = createUserIdentity({ execCommand: exec });
      expect(await identity.getUserType()).toBe("client");
    });

    it("uses custom internalDomain when provided", async () => {
      const exec = makeExec({
        "gh api /user/orgs": orgsResponse([]),
        "gh api /user": userResponse("user@acme.com"),
      });
      const identity = createUserIdentity({
        execCommand: exec,
        internalDomain: "acme.com",
      });
      expect(await identity.getUserType()).toBe("internal");
    });
  });

  describe("getUserType() — both checks fail", () => {
    it("returns 'client' when both gh api calls fail", async () => {
      const exec = makeExec({
        "gh api /user/orgs": new Error("not found"),
        "gh api /user": new Error("not found"),
      });
      const identity = createUserIdentity({ execCommand: exec });
      expect(await identity.getUserType()).toBe("client");
    });
  });

  describe("getUserType() — result is cached", () => {
    it("only calls gh api once even when getUserType is called multiple times", async () => {
      const exec = makeExec({
        "gh api /user/orgs": orgsResponse(["zivtech"]),
        "gh api /user": userResponse(undefined),
      });
      const identity = createUserIdentity({ execCommand: exec });

      const first = await identity.getUserType();
      const second = await identity.getUserType();
      const third = await identity.getUserType();

      expect(first).toBe("internal");
      expect(second).toBe("internal");
      expect(third).toBe("internal");

      // exec should have been called exactly twice (once for orgs, once for user)
      expect(exec).toHaveBeenCalledTimes(2);
    });

    it("caches 'client' result as well", async () => {
      const exec = makeExec({
        "gh api /user/orgs": orgsResponse([]),
        "gh api /user": userResponse(undefined),
      });
      const identity = createUserIdentity({ execCommand: exec });

      await identity.getUserType();
      await identity.getUserType();

      expect(exec).toHaveBeenCalledTimes(2);
    });
  });

  describe("getUserType() — internal when either check passes", () => {
    it("returns 'internal' when org match even if domain does not match", async () => {
      const exec = makeExec({
        "gh api /user/orgs": orgsResponse(["zivtech"]),
        "gh api /user": userResponse("user@gmail.com"),
      });
      const identity = createUserIdentity({ execCommand: exec });
      expect(await identity.getUserType()).toBe("internal");
    });

    it("returns 'internal' when domain matches even if not in org", async () => {
      const exec = makeExec({
        "gh api /user/orgs": orgsResponse(["other-org"]),
        "gh api /user": userResponse("user@zivtech.com"),
      });
      const identity = createUserIdentity({ execCommand: exec });
      expect(await identity.getUserType()).toBe("internal");
    });
  });
});
