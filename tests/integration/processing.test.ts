import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { isolated } from "../helpers/database.ts";
import {
  contents,
  tasks,
  shares,
  attempts,
  usageEvents,
  quotaReservations,
  settings,
} from "../../src/server/db/schema.ts";
import { user } from "../../src/server/db/auth-schema.ts";
import {
  processContentJob,
  type ProcessorDependencies,
} from "../../src/server/content/processor.ts";
import { maintainContent } from "../../src/server/content/maintenance.ts";
import { ProcessingError } from "../../src/server/content/types.ts";
import { reserveQuota } from "../../src/server/quota.ts";

it("A4 processes articles/videos, reserves quota, resumes once, fences stale workers and never repeats unknown paid calls", async () => {
  await isolated(async (pool) => {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: "drizzle" });
    await db.insert(user).values({
      id: "reader",
      name: "Reader",
      email: "reader@authright.com",
      emailVerified: true,
    });
    const boss = new PgBoss({
      connectionString: pool.options.connectionString!,
      supervise: false,
      schedule: false,
    });
    await boss.start();
    await boss.createQueue("process-content");
    try {
      async function seed(
        type: "article" | "youtube" = "article",
        shared = true,
      ) {
        const [content] = await db
          .insert(contents)
          .values({
            type,
            dedupeKey: randomUUID(),
            originalUrl: "https://example.com/article",
            normalizedUrl: "https://example.com/article",
            videoId: type === "youtube" ? "dQw4w9WgXcQ" : null,
          })
          .returning();
        if (shared)
          await db.insert(shares).values({
            contentId: content.id,
            userId: "reader",
            originalUrl: content.originalUrl,
          });
        const jobId = await boss.send("process-content", {
          contentId: content.id,
          generation: 1,
        });
        const [task] = await db
          .insert(tasks)
          .values({ contentId: content.id, jobId: jobId! })
          .returning();
        return { content, task, jobId: jobId! };
      }
      const summarize = vi.fn(async () => ({
        summary: {
          overview: "An English overview.",
          key_points: ["First point", "Second point", "Third point"],
        },
        model: "fixture-model",
        inputTokens: 100,
        outputTokens: 50,
      }));
      const deps: ProcessorDependencies = {
        database: db,
        summary: {
          configured: true,
          model: "fixture-model",
          pricing: {
            version: "fixture-1",
            currency: "USD",
            inputPerMillion: "0.30",
            outputPerMillion: "2.50",
          },
          summarize,
        },
        fetchArticle: async () => ({
          html: "fixture",
          url: "https://example.com/article",
        }),
        extract: () => ({
          title: "Fixture article",
          text: "TEMPORARY_BODY_MUST_NOT_PERSIST",
          author: "Author",
        }),
        video: async () => ({
          title: "A video",
          videoDescription: "",
          author: "Channel",
          thumbnailUrl: null,
          embeddable: false,
          durationSeconds: 90,
        }),
      };
      const article = await seed();
      await processContentJob(article.jobId, deps);
      expect(
        (
          await db
            .select()
            .from(contents)
            .where(eq(contents.id, article.content.id))
        )[0],
      ).toMatchObject({ status: "ready", summaryModel: "fixture-model" });
      expect(await db.select().from(usageEvents)).toMatchObject([
        {
          status: "succeeded",
          priceVersion: "fixture-1",
          currency: "USD",
          inputPricePerMillion: "0.3000000000",
          outputPricePerMillion: "2.5000000000",
          estimatedAmount: "0.0001550000",
        },
      ]);
      const video = await seed("youtube");
      await processContentJob(video.jobId, deps);
      expect(summarize).toHaveBeenCalledTimes(1);
      expect(
        (
          await db
            .select()
            .from(contents)
            .where(eq(contents.id, video.content.id))
        )[0],
      ).toMatchObject({ status: "ready", videoDescription: "" });
      await db
        .update(settings)
        .set({ quotaEnabled: true, monthlyCallLimit: 1 });
      const deferred = await seed();
      await processContentJob(deferred.jobId, deps);
      expect(
        (await db.select().from(tasks).where(eq(tasks.id, deferred.task.id)))[0]
          .state,
      ).toBe("deferred_quota");
      expect(summarize).toHaveBeenCalledTimes(1);
      await db.update(settings).set({ monthlyCallLimit: 2 });
      await maintainContent(boss, db);
      await maintainContent(boss, db);
      const resumed = await db
        .select()
        .from(tasks)
        .where(eq(tasks.contentId, deferred.content.id));
      expect(resumed).toHaveLength(2);
      await processContentJob(
        resumed.find((task) => task.generation === 2)!.jobId,
        deps,
      );
      expect(summarize).toHaveBeenCalledTimes(2);
      await db.update(settings).set({ quotaEnabled: false });
      const freeTier = await seed();
      await processContentJob(freeTier.jobId, {
        ...deps,
        summary: {
          ...deps.summary,
          pricing: {
            version: "fixture-free",
            currency: "USD",
            inputPerMillion: "0",
            outputPerMillion: "0",
          },
        },
      });
      expect(
        await db
          .select()
          .from(usageEvents)
          .where(eq(usageEvents.priceVersion, "fixture-free")),
      ).toMatchObject([
        {
          status: "succeeded",
          usageKnown: true,
          inputTokens: 100,
          outputTokens: 50,
          inputPricePerMillion: "0.0000000000",
          outputPricePerMillion: "0.0000000000",
          estimatedAmount: "0.0000000000",
        },
      ]);
      const unknown = await seed();
      const lost = vi.fn(async () => {
        throw new Error("secret-provider-error");
      });
      const unknownDeps = {
        ...deps,
        summary: { configured: true, model: "fixture-model", summarize: lost },
      };
      await processContentJob(unknown.jobId, unknownDeps);
      await processContentJob(unknown.jobId, unknownDeps);
      await maintainContent(boss, db);
      expect(lost).toHaveBeenCalledTimes(1);
      expect(
        (await db.select().from(tasks).where(eq(tasks.id, unknown.task.id)))[0],
      ).toMatchObject({ state: "failed", failureCode: "OUTCOME_UNKNOWN" });
      const stale = await seed();
      await processContentJob(stale.jobId, {
        ...deps,
        summary: {
          ...deps.summary,
          summarize: async () => {
            await db
              .update(tasks)
              .set({ leaseToken: null, leaseExpiresAt: null, state: "failed" })
              .where(eq(tasks.id, stale.task.id));
            await db
              .update(contents)
              .set({ status: "failed" })
              .where(eq(contents.id, stale.content.id));
            return summarize();
          },
        },
      });
      expect(
        (
          await db
            .select()
            .from(contents)
            .where(eq(contents.id, stale.content.id))
        )[0].status,
      ).toBe("failed");
      const abandoned = await seed("article", false);
      await processContentJob(abandoned.jobId, deps);
      expect(
        (
          await db.select().from(tasks).where(eq(tasks.id, abandoned.task.id))
        )[0].state,
      ).toBe("cancelled");
      expect(
        (
          await db
            .select()
            .from(contents)
            .where(eq(contents.id, abandoned.content.id))
        )[0],
      ).toMatchObject({ status: "failed", failureCode: "NO_ACTIVE_SHARES" });
      const network = await seed();
      const broken = {
        ...deps,
        fetchArticle: async () => {
          throw new ProcessingError("FETCH_FAILED", true);
        },
      };
      await expect(processContentJob(network.jobId, broken)).rejects.toThrow(
        "FETCH_FAILED",
      );
      await expect(processContentJob(network.jobId, broken)).rejects.toThrow(
        "FETCH_FAILED",
      );
      await processContentJob(network.jobId, broken);
      expect(
        (await db.select().from(tasks).where(eq(tasks.id, network.task.id)))[0],
      ).toMatchObject({ state: "failed", attempts: 3 });
      const crashed = await seed();
      await db
        .update(tasks)
        .set({
          state: "processing",
          attempts: 1,
          leaseToken: randomUUID(),
          leaseExpiresAt: new Date(Date.now() - 1000),
        })
        .where(eq(tasks.id, crashed.task.id));
      const [crashAttempt] = await db
        .insert(attempts)
        .values({
          taskId: crashed.task.id,
          generation: 1,
          attemptNo: 1,
          stage: "summarize",
        })
        .returning();
      await reserveQuota(crashAttempt.id, db);
      await db
        .update(quotaReservations)
        .set({ status: "consumed" })
        .where(eq(quotaReservations.attemptId, crashAttempt.id));
      await db.insert(usageEvents).values({
        attemptId: crashAttempt.id,
        service: "summary",
        status: "started",
      });
      await maintainContent(boss, db);
      expect(
        (await db.select().from(tasks).where(eq(tasks.id, crashed.task.id)))[0]
          .failureCode,
      ).toBe("OUTCOME_UNKNOWN");
      await db
        .update(contents)
        .set({
          metadataFetchedAt: new Date(Date.now() - 29.1 * 86400000),
          metadataExpiresAt: new Date(Date.now() + 0.9 * 86400000),
        })
        .where(eq(contents.id, video.content.id));
      await maintainContent(boss, db);
      expect(
        (
          await db
            .select()
            .from(tasks)
            .where(eq(tasks.contentId, video.content.id))
        ).some((task) => task.kind === "youtube_refresh"),
      ).toBe(true);
      await db
        .update(contents)
        .set({ metadataExpiresAt: new Date(Date.now() - 1) })
        .where(eq(contents.id, video.content.id));
      await maintainContent(boss, db);
      expect(
        (
          await db
            .select()
            .from(contents)
            .where(eq(contents.id, video.content.id))
        )[0],
      ).toMatchObject({
        title: null,
        videoDescription: null,
        metadataExpiresAt: null,
      });
      const reservations = await db.select().from(quotaReservations);
      await db.update(settings).set({
        quotaEnabled: true,
        monthlyCallLimit:
          reservations.filter((r) => r.status !== "released").length + 1,
      });
      const quotaAttempts = [];
      for (let i = 0; i < 2; i++) {
        const row = await seed();
        const [attempt] = await db
          .insert(attempts)
          .values({
            taskId: row.task.id,
            generation: 1,
            attemptNo: 1,
            stage: "summarize",
          })
          .returning();
        quotaAttempts.push(attempt);
      }
      const admitted = await Promise.all(
        quotaAttempts.map((attempt) => reserveQuota(attempt.id, db)),
      );
      expect(admitted.filter(Boolean)).toHaveLength(1);
      const stored = JSON.stringify({
        contents: await db.select().from(contents),
        attempts: await db.select().from(attempts),
        usage: await db.select().from(usageEvents),
        jobs: (await pool.query("select data, output from pgboss.job")).rows,
      });
      expect(stored).not.toMatch(
        /TEMPORARY_BODY_MUST_NOT_PERSIST|secret-provider-error/,
      );
    } finally {
      await boss.stop();
    }
  });
}, 30000);
