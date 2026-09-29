import { CONTENT_QUEUE_SECONDS } from "../src/server/content/limits.ts";
// Opt-in real-service test. Creates and removes a disposable test database;
// never modifies saved application shares or production configuration.
// node --env-file=.env --import tsx scripts/validate-youtube-worker.ts VIDEO_ID
import { mkdir, writeFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { PgBoss } from "pg-boss";
import { isolated } from "../tests/helpers/database.ts";
import {
  createGeminiAudio,
  createGeminiSummary,
} from "../src/server/content/gemini.ts";
import { downloadYoutubeAudio } from "../src/server/content/youtube-audio.ts";
import {
  contents,
  tasks,
  shares,
  usageEvents,
  quotaReservations,
} from "../src/server/db/schema.ts";
import { user } from "../src/server/db/auth-schema.ts";

const videoId = process.argv[2];
if (!/^[A-Za-z0-9_-]{11}$/.test(videoId ?? ""))
  throw new Error("Provide one video ID.");
if (
  !process.env.TEST_DATABASE_URL ||
  new URL(process.env.TEST_DATABASE_URL).pathname !== "/sharing_test"
)
  throw new Error("Requires isolated sharing_test database.");
if (
  !process.env.GEMINI_API_KEY ||
  !process.env.YOUTUBE_API_KEY ||
  process.env.GEMINI_BILLING_TIER !== "free"
)
  throw new Error("Requires existing API keys and explicit free tier.");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { processContentJob } =
  await import("../src/server/content/processor.ts");
const { pool } = await import("../src/server/db/index.ts");
const directory = `test-results/youtube-worker/${videoId}-${Date.now()}`;
await mkdir(directory, { recursive: true });
try {
  await isolated(async (testPool) => {
    const database = drizzle(testPool);
    await migrate(database, { migrationsFolder: "drizzle" });
    const boss = new PgBoss({
      connectionString: testPool.options.connectionString!,
      supervise: false,
      schedule: false,
    });
    try {
      await boss.start();
      await boss.createQueue("process-content", {
        expireInSeconds: CONTENT_QUEUE_SECONDS,
      });
      await database.insert(user).values({
        id: "audio-probe",
        name: "Audio probe",
        email: "audio-probe@authright.com",
        emailVerified: true,
      });
      const url = `https://www.youtube.com/watch?v=${videoId}`;
      const [content] = await database
        .insert(contents)
        .values({
          type: "youtube",
          videoId,
          originalUrl: url,
          normalizedUrl: url,
          dedupeKey: `youtube:${videoId}`,
        })
        .returning();
      await database.insert(shares).values({
        contentId: content.id,
        userId: "audio-probe",
        originalUrl: url,
      });
      const jobId = await boss.send("process-content", {
        contentId: content.id,
        generation: 1,
      });
      await database
        .insert(tasks)
        .values({ contentId: content.id, jobId: jobId! });
      const httpStatuses: number[] = [];
      const send: typeof fetch = async (url, options) => {
        const response = await fetch(url, options);
        httpStatuses.push(response.status);
        return response;
      };
      const started = Date.now();
      await processContentJob(jobId!, {
        database,
        summary: createGeminiSummary(process.env.GEMINI_API_KEY!, "free", send),
        audio: createGeminiAudio(process.env.GEMINI_API_KEY!, "free", send),
        youtubeKey: process.env.YOUTUBE_API_KEY,
        downloadAudio: (id, signal) =>
          downloadYoutubeAudio(id, signal, {
            ytDlpPath: process.env.YT_DLP_PATH,
            ffmpegPath: process.env.FFMPEG_PATH,
            proxyUrl: process.env.YOUTUBE_PROXY_URL,
          }),
      });
      const [result] = await database.select().from(contents);
      const calls = await database.select().from(usageEvents);
      const reservations = await database.select().from(quotaReservations);
      const report = {
        at: new Date().toISOString(),
        elapsedMs: Date.now() - started,
        videoId,
        httpStatuses,
        result,
        calls,
        reservations,
      };
      await writeFile(
        `${directory}/result.json`,
        JSON.stringify(report, null, 2),
      );
      console.log(
        JSON.stringify({
          status: result.status,
          httpStatuses,
          failureCode: result.failureCode,
          elapsedMs: report.elapsedMs,
          summary: result.summaryOverview,
          calls: calls.map((c) => ({
            service: c.service,
            status: c.status,
            inputTokens: c.inputTokens,
            outputTokens: c.outputTokens,
          })),
          reportPath: `${directory}/result.json`,
        }),
      );
      if (
        result.status !== "ready" ||
        calls.length !== 2 ||
        calls.some((c) => c.status !== "succeeded")
      )
        process.exitCode = 1;
    } finally {
      await boss.stop();
    }
  });
} finally {
  await pool.end();
}
