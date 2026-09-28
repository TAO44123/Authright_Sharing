import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { databaseConfig } from "../database-config.ts";

const processState = globalThis as typeof globalThis & {
  sharingPool?: pg.Pool;
};
export const pool =
  processState.sharingPool ??
  new pg.Pool({ connectionString: databaseConfig.DATABASE_URL, max: 10 });
if (process.env.NODE_ENV !== "production") processState.sharingPool = pool;
export const db = drizzle(pool);
