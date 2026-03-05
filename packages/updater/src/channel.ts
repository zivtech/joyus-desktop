export type DeployEnv = "development" | "staging" | "production";
export type Channel = "alpha" | "beta" | "stable";

export function resolveReleaseChannel(environment: DeployEnv, tenantPilot: boolean): Channel {
  if (environment === "development") {
    return "alpha";
  }

  if (environment === "staging") {
    return "beta";
  }

  return tenantPilot ? "beta" : "stable";
}
