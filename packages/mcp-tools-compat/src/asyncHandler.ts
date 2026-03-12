/**
 * Wrapper that ensures MCP tool handlers properly await async operations
 * and surface errors instead of producing unhandled rejections.
 *
 * T031: Fixes the pattern where fire-and-forget async calls inside handlers
 * silently drop errors and leave the MCP server in an inconsistent state.
 */

export type McpHandler<T> = (args: unknown) => Promise<T>;

export interface AsyncHandlerOptions {
  /** Called when the wrapped handler rejects. */
  onError?: (error: unknown) => void;
}

/**
 * Wraps an MCP handler so that:
 * 1. The returned promise is always awaited (no fire-and-forget).
 * 2. Any rejection is caught, optionally reported via `onError`, and re-thrown
 *    so the caller sees a proper error rather than an unhandled rejection.
 */
export function wrapAsyncHandler<T>(
  handler: McpHandler<T>,
  options?: AsyncHandlerOptions
): McpHandler<T> {
  return async (args: unknown): Promise<T> => {
    try {
      const result = await handler(args);
      return result;
    } catch (error: unknown) {
      if (options?.onError) {
        options.onError(error);
      }
      throw error;
    }
  };
}
