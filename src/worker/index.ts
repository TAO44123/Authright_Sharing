import { createSummaryGate } from "../server/content/concurrency.ts";
import { workerConfig } from "../server/worker-config.ts";
import { createBoss, CONTENT_QUEUE } from "../server/queue.ts";
import { logger } from "../server/logger.ts";
import { processContentJob } from "../server/content/processor.ts";
import { maintainContent } from "../server/content/maintenance.ts";
import { unconfiguredSummary } from "../server/content/types.ts";
import { createGeminiSummary } from "../server/content/gemini.ts";
import { pool } from "../server/db/index.ts";
const acquireSummarySlot = createSummaryGate(workerConfig.SUMMARY_CONCURRENCY);
const enabled = workerConfig.CONTENT_PROCESSING_ENABLED;
if (enabled && (!workerConfig.GEMINI_API_KEY || !workerConfig.YOUTUBE_API_KEY))
  throw new Error("Content processing requires GEMINI_API_KEY and YOUTUBE_API_KEY.");
const summary = workerConfig.GEMINI_API_KEY && workerConfig.GEMINI_BILLING_TIER
  ? createGeminiSummary(workerConfig.GEMINI_API_KEY, workerConfig.GEMINI_BILLING_TIER)
  : unconfiguredSummary;
const boss = createBoss(false, enabled);
await boss.start();
let maintaining = false;
async function maintain() {
  if (maintaining) return;
  maintaining = true;
  try {
    await maintainContent(boss);
  } catch {
    logger.error({ event: "maintenance_failed" });
  } finally {
    maintaining = false;
  }
}
if (enabled) {
  await maintain();
  await boss.work(
    CONTENT_QUEUE,
    { batchSize: 1, localConcurrency: workerConfig.WORKER_CONCURRENCY },
    async (jobs) => {
      for (const job of jobs)
        await processContentJob(
          job.id,
          {
            summary,
            acquireSummarySlot,
            youtubeKey: workerConfig.YOUTUBE_API_KEY,
          },
          job.signal,
        );
    },
  );
}
logger.info({
  event: "worker_ready",
  contentConsumption: enabled ? "enabled" : "paused",
  concurrency: workerConfig.WORKER_CONCURRENCY,
});
const heartbeat = setInterval(() => {
  logger.info({
    event: "worker_heartbeat",
    contentConsumption: enabled ? "enabled" : "paused",
  });
  if (enabled) void maintain();
}, 60000);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, async () => {
    clearInterval(heartbeat);
    await boss.stop({ graceful: true, timeout: 150000 });
    await pool.end();
  });
