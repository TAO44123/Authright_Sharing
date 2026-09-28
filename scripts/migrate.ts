import { CONTENT_QUEUE_SECONDS } from "../src/server/content/limits.ts";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/server/db/index.ts";
import { createBoss, CONTENT_QUEUE } from "../src/server/queue.ts";
import { inArray } from "drizzle-orm";
import { tasks } from "../src/server/db/schema.ts";
const boss = createBoss(true);
try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await boss.start();
  await boss.createQueue(CONTENT_QUEUE, {
    retryLimit: 2,
    expireInSeconds: CONTENT_QUEUE_SECONDS,
    retryDelay: 10,
    retryBackoff: true,
  });
  await boss.updateQueue(CONTENT_QUEUE, {
    expireInSeconds: CONTENT_QUEUE_SECONDS,
  });
  // Queue defaults only affect future jobs. Upgrade waiting deliveries too;
  // pg-boss update() leaves active/finished jobs and existing payloads untouched.
  const waiting = await db
    .select({ jobId: tasks.jobId })
    .from(tasks)
    .where(inArray(tasks.state, ["queued", "retry_wait"]));
  for (const task of waiting)
    await boss.update(CONTENT_QUEUE, undefined, {
      id: task.jobId,
      expireInSeconds: CONTENT_QUEUE_SECONDS,
    });
  console.log("Database migrations and content queue ready.");
} finally {
  await boss.stop();
  await pool.end();
}
