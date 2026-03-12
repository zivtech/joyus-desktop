/**
 * Config reader for telemetry wiring.
 *
 * T036: Telemetry was previously hard-coded or silently ignored.
 * This reader centralises the config source (env vars) and provides
 * a clear enabled/disabled check so packages can wire collectors uniformly.
 */

export interface TelemetryConfig {
  endpoint: string;
  apiKey: string;
  enabled: boolean;
}

/**
 * Reads telemetry configuration from the supplied environment map.
 *
 * | Env var              | Field      | Default  |
 * |----------------------|------------|----------|
 * | TELEMETRY_ENDPOINT   | endpoint   | `""`     |
 * | TELEMETRY_API_KEY    | apiKey     | `""`     |
 * | TELEMETRY_ENABLED    | enabled    | `false`  |
 *
 * `enabled` is `true` only when `TELEMETRY_ENABLED` is the literal
 * string `"true"` (case-sensitive).
 */
export function readTelemetryConfig(env: Record<string, string | undefined>): TelemetryConfig {
  return {
    endpoint: env["TELEMETRY_ENDPOINT"] ?? "",
    apiKey: env["TELEMETRY_API_KEY"] ?? "",
    enabled: env["TELEMETRY_ENABLED"] === "true",
  };
}

/**
 * Returns `true` when telemetry should be active: `enabled` is true **and**
 * a non-empty `endpoint` has been configured.
 */
export function isTelemetryEnabled(config: TelemetryConfig): boolean {
  return config.enabled && config.endpoint.length > 0;
}
