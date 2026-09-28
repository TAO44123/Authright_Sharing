import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { fromDrizzle, type PgBoss } from "pg-boss";
import { db } from "../db/index.ts";
import {
  contents,
  tasks,
  attempts,
  usageEvents,
  quotaReservations,
  settings,
} from "../db/schema.ts";
import { CONTENT_QUEUE } from "../queue.ts";
import { billingMonth, settleQuota } from "../quota.ts";

export async function maintainContent(boss: PgBoss, database = db) {
  // A single maintenance pass at a time; transaction-scoped advisory lock is
  // released on crashes. Reads also suppress expired API metadata independently.
  await database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(820021)`);
    await tx
      .update(contents)
      .set({
        title: null,
        author: null,
        thumbnailUrl: null,
        videoDescription: null,
        durationSeconds: null,
        embeddable: null,
        metadataFetchedAt: null,
        metadataExpiresAt: null,
        status: sql`case when ${contents.summaryOverview} is not null then ${contents.status} else 'failed' end`,
        failureCode: sql`case when ${contents.summaryOverview} is not null then ${contents.failureCode} else 'METADATA_EXPIRED' end`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(contents.type, "youtube"),
          lt(contents.metadataExpiresAt, new Date()),
        ),
      );
    const stalled = await tx
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.state, "processing"),
          lt(tasks.leaseExpiresAt, new Date()),
        ),
      )
      .for("update");
    for (const task of stalled) {
      const called = await tx
        .select({ id: usageEvents.id })
        .from(usageEvents)
        .innerJoin(attempts, eq(attempts.id, usageEvents.attemptId))
        .where(
          and(
            eq(attempts.taskId, task.id),
            eq(attempts.generation, task.generation),
            eq(attempts.outcome, "started"),
          ),
        );
      await tx
        .update(quotaReservations)
        .set({ status: "released", updatedAt: new Date() })
        .where(
          and(
            eq(quotaReservations.status, "reserved"),
            sql`${quotaReservations.attemptId} in (select id from processing_attempts where task_id = ${task.id} and outcome = 'started')`,
          ),
        );
      const unknown = called.length > 0;
      const code = unknown ? "OUTCOME_UNKNOWN" : "LEASE_EXPIRED";
      await tx
        .update(attempts)
        .set({
          outcome: unknown ? "outcome_unknown" : "failed",
          failureCode: code,
          finishedAt: new Date(),
        })
        .where(
          and(eq(attempts.taskId, task.id), eq(attempts.outcome, "started")),
        );
      for (const call of called)
        await tx
          .update(usageEvents)
          .set({ status: "outcome_unknown" })
          .where(
            and(eq(usageEvents.id, call.id), eq(usageEvents.status, "started")),
          );
      const interrupted = await tx
        .select({ id: attempts.id })
        .from(attempts)
        .where(
          and(
            eq(attempts.taskId, task.id),
            eq(attempts.generation, task.generation),
          ),
        );
      for (const item of interrupted) await settleQuota(item.id, tx);
      // Never blindly resend a paid request whose outcome cannot be recovered.
      await tx
        .update(tasks)
        .set({
          state: unknown || task.attempts >= 3 ? "failed" : "retry_wait",
          leaseToken: null,
          leaseExpiresAt: null,
          failureCode: code,
          finishedAt: new Date(),
        })
        .where(eq(tasks.id, task.id));
      await tx
        .update(contents)
        .set({
          status: unknown || task.attempts >= 3 ? "failed" : "queued",
          failureCode: code,
        })
        .where(eq(contents.id, task.contentId));
    }
    const [setting] = await tx
      .select()
      .from(settings)
      .where(eq(settings.id, 1))
      .for("update");
    const [{ used }] = await tx
      .select({
        used: sql<number>`coalesce(sum(${quotaReservations.units}),0)::int`,
      })
      .from(quotaReservations)
      .where(
        and(
          eq(quotaReservations.billingMonth, billingMonth()),
          inArray(quotaReservations.status, ["reserved", "consumed"]),
        ),
      );
    if (!setting.quotaEnabled || used < setting.monthlyCallLimit!) {
      const deferred = await tx
        .select()
        .from(tasks)
        .where(eq(tasks.state, "deferred_quota"))
        .for("update");
      for (const task of deferred) {
        const [item] = await tx
          .select({ type: contents.type })
          .from(contents)
          .where(eq(contents.id, task.contentId));
        if (
          setting.quotaEnabled &&
          used + (item.type === "youtube" ? 2 : 1) > setting.monthlyCallLimit!
        )
          continue;
        await tx
          .update(tasks)
          .set({ state: "completed", finishedAt: new Date() })
          .where(eq(tasks.id, task.id));
        const jobId = await boss.send(
          CONTENT_QUEUE,
          {
            contentId: task.contentId,
            generation: task.generation + 1,
            version: 1,
          },
          {
            db: fromDrizzle(tx, sql),
            retryLimit: 2,
            retryDelay: 10,
            retryBackoff: true,
          },
        );
        if (!jobId) throw new Error("QUEUE_REJECTED");
        await tx.insert(tasks).values({
          contentId: task.contentId,
          generation: task.generation + 1,
          jobId,
        });
        await tx
          .update(contents)
          .set({ status: "queued", failureCode: null })
          .where(eq(contents.id, task.contentId));
      }
    }
    const refresh = await tx
      .select()
      .from(contents)
      .where(
        and(
          eq(contents.type, "youtube"),
          or(
            isNull(contents.metadataFetchedAt),
            lt(
              contents.metadataFetchedAt,
              new Date(Date.now() - 29 * 86400000),
            ),
          ),
          sql`exists (select 1 from shares where shares.content_id = ${contents.id} and shares.withdrawn_at is null)`,
          sql`not exists (select 1 from content_tasks where content_tasks.content_id = ${contents.id} and content_tasks.state in ('queued','processing','retry_wait','deferred_quota'))`,
          sql`not exists (select 1 from content_tasks where content_tasks.content_id = ${contents.id} and content_tasks.kind = 'youtube_refresh' and content_tasks.created_at > now() - interval '6 hours')`,
        ),
      )
      .for("update");
    for (const content of refresh) {
      const [{ generation }] = await tx
        .select({
          generation: sql<number>`coalesce(max(${tasks.generation}), 0)::int + 1`,
        })
        .from(tasks)
        .where(eq(tasks.contentId, content.id));
      const jobId = await boss.send(
        CONTENT_QUEUE,
        { contentId: content.id, generation, version: 1 },
        {
          db: fromDrizzle(tx, sql),
          retryLimit: 2,
          retryDelay: 10,
          retryBackoff: true,
        },
      );
      if (!jobId) throw new Error("QUEUE_REJECTED");
      await tx.insert(tasks).values({
        contentId: content.id,
        kind: "youtube_refresh",
        generation,
        jobId,
      });
    }
    // Unreferenced caches are unnecessary even before their expiry.
    await tx
      .update(contents)
      .set({
        title: null,
        author: null,
        thumbnailUrl: null,
        videoDescription: null,
        durationSeconds: null,
        embeddable: null,
        metadataFetchedAt: null,
        metadataExpiresAt: null,
      })
      .where(
        and(
          eq(contents.type, "youtube"),
          sql`not exists (select 1 from shares where shares.content_id = ${contents.id} and shares.withdrawn_at is null)`,
        ),
      );
  });
  // Queue supervision owns retries. Reconcile terminal or missing delivery jobs;
  // do not add a second consumer or duplicate a still-active pg-boss delivery.
  const pending = await database
    .select()
    .from(tasks)
    .where(inArray(tasks.state, ["queued", "retry_wait"]))
    .limit(100);
  for (const task of pending) {
    const job = await boss.getJobById(CONTENT_QUEUE, task.jobId);
    if (job && !["failed", "cancelled", "completed"].includes(job.state))
      continue;
    await database.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(tasks)
        .where(eq(tasks.id, task.id))
        .for("update");
      if (
        !current ||
        current.jobId !== task.jobId ||
        !["queued", "retry_wait"].includes(current.state)
      )
        return;
      if (current.attempts >= 3) {
        await tx
          .update(tasks)
          .set({ state: "failed", failureCode: "RETRIES_EXHAUSTED" })
          .where(eq(tasks.id, task.id));
        await tx
          .update(contents)
          .set({ status: "failed", failureCode: "RETRIES_EXHAUSTED" })
          .where(eq(contents.id, task.contentId));
        return;
      }
      const jobId = await boss.send(
        CONTENT_QUEUE,
        { contentId: task.contentId, generation: task.generation, version: 1 },
        {
          db: fromDrizzle(tx, sql),
          retryLimit: 2,
          retryDelay: 10,
          retryBackoff: true,
        },
      );
      if (!jobId) throw new Error("QUEUE_REJECTED");
      await tx
        .update(tasks)
        .set({ jobId, state: "queued" })
        .where(eq(tasks.id, task.id));
    });
  }
}
