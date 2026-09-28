import pg from "pg";
import { randomUUID } from "node:crypto";
export async function isolated(run: (pool: pg.Pool) => Promise<void>) {
  const url = new URL(process.env.DATABASE_URL!);
  if (url.pathname !== "/sharing_test")
    throw new Error("Isolated test database required");
  const admin = new pg.Pool({ connectionString: url.href });
  const name = `sharing_test_migration_${randomUUID().replaceAll("-", "")}`;
  let pool: pg.Pool | undefined;
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    created = true;
    url.pathname = `/${name}`;
    pool = new pg.Pool({ connectionString: url.href });
    await run(pool);
  } finally {
    await pool?.end();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
}
