import type { GovernanceContext, GovernanceDeps, GovernanceResult } from "./types";

export async function enforceGovernance(
  context: GovernanceContext,
  deps: GovernanceDeps
): Promise<GovernanceResult> {
  const config = await deps.readConfig();

  if (config.mode === "off") {
    return { proceed: true, decision: "allow", audited: false };
  }

  if (config.mode === "audit") {
    return enforceAuditMode(context, deps);
  }

  return enforceEnforceMode(context, deps);
}

async function enforceAuditMode(
  context: GovernanceContext,
  deps: GovernanceDeps
): Promise<GovernanceResult> {
  let decision: GovernanceResult["decision"];

  try {
    decision = await deps.checkPolicy(context.toolName, context);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    deps.log("error", `Policy check failed in audit mode for ${context.toolName}: ${message}`);
    return { proceed: true, decision: "allow", audited: true, error: message };
  }

  deps.log("info", `Audit: tool=${context.toolName} decision=${decision}`);
  return { proceed: true, decision, audited: true };
}

async function enforceEnforceMode(
  context: GovernanceContext,
  deps: GovernanceDeps
): Promise<GovernanceResult> {
  let decision: GovernanceResult["decision"];

  try {
    decision = await deps.checkPolicy(context.toolName, context);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    deps.log("error", `Policy check failed in enforce mode for ${context.toolName}: ${message}`);
    return { proceed: false, decision: "deny", audited: true, error: message };
  }

  if (decision === "deny") {
    deps.log("warn", `Blocked: tool=${context.toolName} decision=deny`);
    return { proceed: false, decision: "deny", audited: true };
  }

  deps.log("info", `Allowed: tool=${context.toolName} decision=${decision}`);
  return { proceed: true, decision, audited: true };
}
