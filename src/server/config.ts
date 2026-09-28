import { readEnv, webEnvSchema } from "./env.ts";
export const config = readEnv(webEnvSchema);
export const googleConfigured = Boolean(
  config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET,
);
