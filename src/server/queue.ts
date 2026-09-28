import { PgBoss } from "pg-boss";
import { databaseConfig } from "./database-config.ts";
import { logger } from "./logger.ts";
export const CONTENT_QUEUE = "process-content";
export function createBoss(migrate = false, worker = false) {
  const boss = new PgBoss({
    connectionString: databaseConfig.DATABASE_URL,
    migrate,
    supervise: worker,
    schedule: worker,
  });
  boss.on("error", () =>
    logger.error({ event: "queue_error" }, "Queue operation failed"),
  );
  return boss;
}
const processState = globalThis as typeof globalThis & {
  sharingBoss?: Promise<PgBoss>;
};
export function getBoss() {
  return (processState.sharingBoss ??= (async () => {
    const boss = createBoss();
    await boss.start();
    return boss;
  })().catch((error) => {
    processState.sharingBoss = undefined;
    throw error;
  }));
}
