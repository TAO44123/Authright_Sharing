import { readEnv, workerEnvSchema } from "./env.ts";
export const workerConfig = readEnv(workerEnvSchema);
