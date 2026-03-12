export interface OptOutConfig {
  telemetryDisabled: boolean;
}

export interface OptOutReader {
  read(): OptOutConfig;
}

export function isOptedOut(config: OptOutConfig): boolean {
  return config.telemetryDisabled;
}

const TRUTHY_VALUES = ["true", "1", "yes"];

export function createEnvOptOutReader(
  env: Record<string, string | undefined>,
): OptOutReader {
  return {
    read(): OptOutConfig {
      const value = env["SKILL_TELEMETRY_DISABLED"];
      const disabled =
        value !== undefined && TRUTHY_VALUES.includes(value.toLowerCase());
      return { telemetryDisabled: disabled };
    },
  };
}

export function createConfigOptOutReader(
  readFile: () => string | null,
): OptOutReader {
  return {
    read(): OptOutConfig {
      const content = readFile();
      if (content === null) {
        return { telemetryDisabled: false };
      }
      try {
        const parsed: unknown = JSON.parse(content);
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "telemetry_disabled" in parsed &&
          typeof (parsed as Record<string, unknown>)["telemetry_disabled"] ===
            "boolean"
        ) {
          return {
            telemetryDisabled: (parsed as Record<string, boolean>)[
              "telemetry_disabled"
            ] as boolean,
          };
        }
        return { telemetryDisabled: false };
      } catch {
        return { telemetryDisabled: false };
      }
    },
  };
}

export function resolveOptOut(readers: OptOutReader[]): OptOutConfig {
  for (const reader of readers) {
    const config = reader.read();
    if (config.telemetryDisabled) {
      return { telemetryDisabled: true };
    }
  }
  return { telemetryDisabled: false };
}
