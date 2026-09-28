import pino, { type DestinationStream } from "pino";
import { logEnvSchema, readEnv } from "./env.ts";

// Allowlisted scalar metadata only: no arbitrary request/error/provider objects.
export function safeLogFields(input: Record<string, unknown>) {
  const safe: Record<string, string | number> = {};
  for (const key of [
    "event",
    "stage",
    "result",
    "errorCode",
    "contentConsumption",
  ]) {
    const value = input[key];
    if (typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value))
      safe[key] = value;
  }
  for (const key of ["requestId", "taskId", "attemptId"]) {
    const value = input[key];
    if (typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value))
      safe[key] = value;
  }
  for (const key of ["durationMs", "status", "concurrency"]) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value)) safe[key] = value;
  }
  return safe;
}
export function createLogger(level: string, destination?: DestinationStream) {
  const options: pino.LoggerOptions = {
    level,
    base: undefined,
    formatters: { log: safeLogFields, bindings: () => ({}) },
    hooks: {
      logMethod(args, method) {
        // Pino messages and Error serialization can contain raw URLs or bodies.
        // Emit only structured fields even when a caller accidentally passes them.
        const fields = args[0];
        method.call(
          this,
          fields && typeof fields === "object"
            ? safeLogFields(fields as Record<string, unknown>)
            : { event: "unstructured_log_suppressed" },
        );
      },
    },
  };
  return destination ? pino(options, destination) : pino(options);
}
export const logger = createLogger(readEnv(logEnvSchema).LOG_LEVEL);
