import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/server/db/index.ts";
import { createBoss, CONTENT_QUEUE } from "../src/server/queue.ts";
const boss = createBoss(true);
try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await boss.start();
  await boss.createQueue(CONTENT_QUEUE, {
    retryLimit: 2,
    expireInSeconds: 300,
    retryDelay: 10,
    retryBackoff: true,
  });
  console.log("Database migrations and content queue ready.");
} finally {
  await boss.stop();
  await pool.end();
}
