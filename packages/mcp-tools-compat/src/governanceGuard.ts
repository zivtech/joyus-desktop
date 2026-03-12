/**
 * Try/catch wrapper for governance enforcement checks that prevents
 * server crashes when the governance service is unavailable.
 *
 * T034: The original code called the governance check without error handling,
 * which crashed the entire MCP server when the governance service was down.
 */

export type GovernanceDecision = "allow" | "deny" | "audit";

export type GovernanceMode = "off" | "audit" | "enforce";

export interface GovernanceCheckFn {
  (toolName: string, context: Record<string, string>): Promise<GovernanceDecision>;
}

export interface GovernanceGuardResult {
  proceed: boolean;
  audited: boolean;
  error?: string;
}

export interface GovernanceGuardOptions {
  check: GovernanceCheckFn;
  mode: GovernanceMode;
  toolName: string;
  context: Record<string, string>;
  /** Optional logger for audit-mode denial notices. */
  onAuditDeny?: (toolName: string, context: Record<string, string>) => void;
}

/**
 * Executes a governance check safely.
 *
 * - **off**: skips the check entirely and always proceeds.
 * - **audit**: runs the check; logs denials via `onAuditDeny` but always proceeds.
 * - **enforce**: runs the check; blocks on "deny" and returns the denial.
 *
 * If the check function throws:
 * - In **enforce** mode the call is blocked with a descriptive error.
 * - In **audit** mode the call proceeds (fail-open).
 */
export async function governanceGuard(opts: GovernanceGuardOptions): Promise<GovernanceGuardResult> {
  if (opts.mode === "off") {
    return { proceed: true, audited: false };
  }

  let decision: GovernanceDecision;

  try {
    decision = await opts.check(opts.toolName, opts.context);
  } catch {
    if (opts.mode === "enforce") {
      return { proceed: false, audited: false, error: "Governance check unavailable" };
    }
    // audit mode: fail-open
    return { proceed: true, audited: true };
  }

  if (opts.mode === "audit") {
    if (decision === "deny") {
      opts.onAuditDeny?.(opts.toolName, opts.context);
    }
    return { proceed: true, audited: true };
  }

  // enforce mode
  if (decision === "deny") {
    return { proceed: false, audited: false, error: "Governance denied" };
  }

  return { proceed: true, audited: decision === "audit" };
}
