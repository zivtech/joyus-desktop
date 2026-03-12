import type { GovernanceContext, GovernanceDeps, GovernanceResult } from "./types";
import { enforceGovernance } from "./governanceEnforcer";
import { emitToolCallEvent } from "./telemetryEmitter";

export interface ToolCallFn {
  (): Promise<unknown>;
}

export interface MiddlewareResult {
  governance: GovernanceResult;
  toolResult?: unknown;
  error?: string;
}

export interface McpMiddleware {
  (context: GovernanceContext, executeTool: ToolCallFn): Promise<MiddlewareResult>;
}

export function createMcpMiddleware(deps: GovernanceDeps): McpMiddleware {
  return async function middleware(
    context: GovernanceContext,
    executeTool: ToolCallFn
  ): Promise<MiddlewareResult> {
    const governance = await enforceGovernance(context, deps);

    if (!governance.proceed) {
      await emitToolCallEvent(
        {
          userId: context.userId,
          orgId: context.orgId,
          serverName: context.serverName,
          toolName: context.toolName,
          outcome: "blocked",
          durationMs: 0,
          metadata: { decision: governance.decision }
        },
        deps
      );
      return { governance, error: `Tool ${context.toolName} blocked by governance policy` };
    }

    const start = Date.now();
    let toolResult: unknown;
    let outcome: "success" | "failure";

    try {
      toolResult = await executeTool();
      outcome = "success";
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      outcome = "failure";

      await emitToolCallEvent(
        {
          userId: context.userId,
          orgId: context.orgId,
          serverName: context.serverName,
          toolName: context.toolName,
          outcome,
          durationMs: Date.now() - start,
          metadata: { error: message }
        },
        deps
      );

      return { governance, error: message };
    }

    await emitToolCallEvent(
      {
        userId: context.userId,
        orgId: context.orgId,
        serverName: context.serverName,
        toolName: context.toolName,
        outcome,
        durationMs: Date.now() - start
      },
      deps
    );

    return { governance, toolResult };
  };
}
