export type TenantClass = "internal" | "external";
export type RuntimeTarget = "local" | "remote";
export type RiskLevel = "low" | "medium" | "high";

export function selectRuntimeTarget(tenantClass: TenantClass, localAllowedForTenant: boolean): RuntimeTarget {
  if (tenantClass === "external") {
    return "remote";
  }

  return localAllowedForTenant ? "local" : "remote";
}

export function shouldFailClosed(
  riskLevel: RiskLevel,
  policyAvailable: boolean,
  tenantClass: TenantClass
): boolean {
  if (policyAvailable) {
    return false;
  }

  if (tenantClass === "external") {
    return riskLevel !== "low";
  }

  return riskLevel === "high";
}
