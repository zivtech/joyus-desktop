import type { ExecCommand } from "../../local-provisioner/src/runtimeDetector.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type UserType = "internal" | "client";

export interface UserIdentity {
  /** Determine user type from GitHub org membership or Google domain. */
  getUserType(): Promise<UserType>;
}

export interface UserIdentityDeps {
  readonly execCommand: ExecCommand;
  readonly zivtechOrg?: string;
  readonly internalDomain?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface GitHubOrg {
  login: string;
}

interface GitHubUser {
  email?: string;
}

async function checkGitHubOrgMembership(
  execCommand: ExecCommand,
  orgName: string,
): Promise<boolean> {
  try {
    const { stdout } = await execCommand(["gh", "api", "/user/orgs"]);
    const orgs = JSON.parse(stdout) as GitHubOrg[];
    return orgs.some(
      (org) => org.login.toLowerCase() === orgName.toLowerCase(),
    );
  } catch {
    return false;
  }
}

async function checkGoogleDomain(
  execCommand: ExecCommand,
  domain: string,
): Promise<boolean> {
  try {
    const { stdout } = await execCommand(["gh", "api", "/user"]);
    const user = JSON.parse(stdout) as GitHubUser;
    const email = user.email ?? "";
    return email.toLowerCase().endsWith(`@${domain.toLowerCase()}`);
  } catch {
    return false;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createUserIdentity(deps: UserIdentityDeps): UserIdentity {
  const {
    execCommand,
    zivtechOrg = "zivtech",
    internalDomain = "zivtech.com",
  } = deps;

  let cachedUserType: UserType | undefined;

  return {
    async getUserType(): Promise<UserType> {
      if (cachedUserType !== undefined) {
        return cachedUserType;
      }

      const [isMember, hasDomain] = await Promise.all([
        checkGitHubOrgMembership(execCommand, zivtechOrg),
        checkGoogleDomain(execCommand, internalDomain),
      ]);

      const userType: UserType = isMember || hasDomain ? "internal" : "client";
      cachedUserType = userType;
      return userType;
    },
  };
}
