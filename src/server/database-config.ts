import { databaseEnvSchema, readEnv } from "./env.ts";
export const databaseConfig = readEnv(databaseEnvSchema);
