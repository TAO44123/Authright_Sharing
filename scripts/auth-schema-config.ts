import { betterAuth } from "better-auth";
import { authOptions } from "../src/server/auth-options.ts";
// Schema generation must work before any auth tables exist.
export const auth = betterAuth({
  ...authOptions,
  database: undefined,
  databaseHooks: undefined,
});
