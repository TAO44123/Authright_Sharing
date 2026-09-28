import { SUMMARY_PROMPT_VERSION } from "./summary-contract.ts";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import {
  tasks,
  contents,
  shares,
  attempts,
  usageEvents,
  quotaReservations,
} from "../db/schema.ts";
import { articleSummary } from "../../contracts/index.ts";
import { reserveQuota, recordInvocation } from "../quota.ts";
import { fetchHtml } from "./fetch.ts";
import { extractArticle } from "./extract.ts";
import { youtubePreview, type parseVideo } from "./youtube.ts";
import { ProcessingError, type SummaryProvider } from "./types.ts";

export type ProcessorDependencies = {
  summary: SummaryProvider;
  acquireSummarySlot?: (signal: AbortSignal) => Promise<() => void>;
  fetchArticle?: typeof fetchHtml;
  extract?: typeof extractArticle;
  video?: (
    id: string,
    signal: AbortSignal,
  ) => Promise<ReturnType<typeof parseVideo>>;
  youtubeKey?: string;
  database?: typeof db;
};
export async function processContentJob(
  jobId: string,
  deps: ProcessorDependencies,
  parentSignal?: AbortSignal,
) {
  const database = deps.database ?? db;
  const token = randomUUID();
  const claimed = await database.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(tasks)
      .where(eq(tasks.jobId, jobId))
      .for("update");
    if (!task || !["queued", "retry_wait"].includes(task.state)) return null;
    const [content] = await tx
      .select()
      .from(contents)
      .where(eq(contents.id, task.contentId))
      .for("update");
    const [share] = await tx
      .select({ id: shares.id })
      .from(shares)
      .where(and(eq(shares.contentId, content.id), isNull(shares.withdrawnAt)))
      .limit(1);
    if (!share) {
      await tx
        .update(tasks)
        .set({
          state: "cancelled",
          failureCode: "NO_ACTIVE_SHARES",
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, task.id));
      // A later share of this content must expose a retryable state instead of
      // waiting forever on the cancelled job. Refreshes retain valid metadata.
      if (task.kind !== "youtube_refresh")
        await tx
          .update(contents)
          .set({
            status: "failed",
            failureCode: "NO_ACTIVE_SHARES",
            updatedAt: new Date(),
          })
          .where(eq(contents.id, content.id));
      return null;
    }
    if (task.attempts >= 3) {
      await tx
        .update(tasks)
        .set({ state: "failed", failureCode: "RETRIES_EXHAUSTED" })
        .where(eq(tasks.id, task.id));
      await tx
        .update(contents)
        .set({ status: "failed", failureCode: "RETRIES_EXHAUSTED" })
        .where(eq(contents.id, content.id));
      return null;
    }
    await tx
      .update(tasks)
      .set({
        state: "processing",
        attempts: task.attempts + 1,
        leaseToken: token,
        leaseExpiresAt: new Date(Date.now() + 180000),
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, task.id));
    if (task.kind !== "youtube_refresh")
      await tx
        .update(contents)
        .set({ status: "processing", updatedAt: new Date() })
        .where(eq(contents.id, content.id));
    const [attempt] = await tx
      .insert(attempts)
      .values({
        taskId: task.id,
        generation: task.generation,
        attemptNo: task.attempts + 1,
        stage: content.type === "youtube" ? "youtube" : "fetch",
      })
      .returning();
    return { task, content, attempt };
  });
  if (!claimed) return;
  const { task, content, attempt } = claimed;
  const signal = AbortSignal.any([
    AbortSignal.timeout(120000),
    ...(parentSignal ? [parentSignal] : []),
  ]);
  let invoked = false;
  let releaseSummary: (() => void) | undefined;
  // Apply results only while this exact generation and lease still belong to us.
  async function finish(
    update: Partial<typeof contents.$inferInsert>,
    state: typeof tasks.$inferInsert.state,
    outcome: typeof attempts.$inferInsert.outcome,
    failureCode: string | null = null,
  ) {
    return database.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.id, task.id),
            eq(tasks.generation, task.generation),
            eq(tasks.leaseToken, token),
            eq(tasks.state, "processing"),
          ),
        )
        .for("update");
      if (
        !current ||
        !current.leaseExpiresAt ||
        current.leaseExpiresAt.getTime() <= Date.now()
      )
        return false;
      await tx
        .update(contents)
        .set({ ...update, updatedAt: new Date() })
        .where(eq(contents.id, content.id));
      await tx
        .update(tasks)
        .set({
          state,
          failureCode,
          leaseToken: null,
          leaseExpiresAt: null,
          finishedAt: new Date(),
          updatedAt: new Date(),
          retryAfter: new Date(Date.now() + 60000),
        })
        .where(eq(tasks.id, task.id));
      await tx
        .update(attempts)
        .set({ outcome, failureCode, finishedAt: new Date() })
        .where(eq(attempts.id, attempt.id));
      return true;
    });
  }
  try {
    if (content.type === "youtube") {
      if (!content.videoId) throw new ProcessingError("INVALID_VIDEO_ID");
      const preview = await (
        deps.video ??
        ((id, signal) => youtubePreview(id, deps.youtubeKey, signal))
      )(content.videoId, signal);
      signal.throwIfAborted();
      await finish(
        {
          ...preview,
          status: "ready",
          failureCode: null,
          metadataFetchedAt: new Date(),
          metadataExpiresAt: new Date(Date.now() + 30 * 86400000),
        },
        "completed",
        "succeeded",
      );
      return;
    }
    if (!deps.summary.configured)
      throw new ProcessingError("SUMMARY_NOT_CONFIGURED");
    const source = await (deps.fetchArticle ?? fetchHtml)(
      content.originalUrl,
      signal,
    );
    const article = (deps.extract ?? extractArticle)(source.html, source.url);
    signal.throwIfAborted();
    await database
      .update(attempts)
      .set({ stage: "summarize" })
      .where(eq(attempts.id, attempt.id));
    releaseSummary = await deps.acquireSummarySlot?.(signal);
    if (!(await reserveQuota(attempt.id, database))) {
      await finish(
        {
          status: "deferred_quota",
          failureCode: "QUOTA_REACHED",
          title: article.title,
          author: article.author,
        },
        "deferred_quota",
        "cancelled",
        "QUOTA_REACHED",
      );
      return;
    }
    // The reservation becomes consumed before sending: an uncertain result is
    // accounted for and must never trigger an automatic paid retry.
    await database.transaction(async (tx) => {
      const [lease] = await tx
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.id, task.id),
            eq(tasks.leaseToken, token),
            sql`${tasks.leaseExpiresAt} > now()`,
          ),
        )
        .for("update");
      if (!lease || signal.aborted) throw new ProcessingError("LEASE_LOST");
      await recordInvocation(attempt.id, deps.summary.model, tx, deps.summary.pricing);
    });
    invoked = true;
    const result = await Promise.race([
      deps.summary.summarize({
        title: article.title,
        text: article.text,
        attemptId: attempt.id,
        signal,
      }),
      new Promise<never>((_, reject) => {
        if (signal.aborted)
          reject(new ProcessingError("OUTCOME_UNKNOWN", false, true));
        else
          signal.addEventListener(
            "abort",
            () => reject(new ProcessingError("OUTCOME_UNKNOWN", false, true)),
            { once: true },
          );
      }),
    ]);
    const parsed = articleSummary.safeParse(result.summary);
    const usageKnown =
      result.inputTokens !== null && result.outputTokens !== null;
    if (
      usageKnown &&
      (!Number.isSafeInteger(result.inputTokens) ||
        !Number.isSafeInteger(result.outputTokens) ||
        result.inputTokens! < 0 ||
        result.outputTokens! < 0)
    )
      throw new ProcessingError("INVALID_USAGE");
    await database
      .update(usageEvents)
      .set({
        status: "succeeded",
        usageKnown,
        inputTokens: usageKnown ? result.inputTokens : null,
        outputTokens: usageKnown ? result.outputTokens : null,
        providerRequestId: result.providerRequestId,
        model: result.model,
        estimatedAmount:
          usageKnown && deps.summary.pricing
            ? (
                (result.inputTokens! * Number(deps.summary.pricing.inputPerMillion) +
                  result.outputTokens! * Number(deps.summary.pricing.outputPerMillion)) /
                1_000_000
              ).toFixed(10)
            : null,
      })
      .where(eq(usageEvents.attemptId, attempt.id));
    if (!parsed.success) throw new ProcessingError("INVALID_SUMMARY");
    signal.throwIfAborted();
    await finish(
      {
        status: "ready",
        title: article.title,
        author: article.author,
        summaryOverview: parsed.data.overview,
        summaryKeyPoints: parsed.data.key_points,
        summaryModel: result.model,
        promptVersion: SUMMARY_PROMPT_VERSION,
        generatedAt: new Date(),
        failureCode: null,
      },
      "completed",
      "succeeded",
    );
  } catch (error) {
    const failure =
      error instanceof ProcessingError
        ? error
        : new ProcessingError(
            invoked ? "OUTCOME_UNKNOWN" : "PROCESSING_FAILED",
            !invoked,
            invoked,
          );
    const unknown =
      invoked &&
      (failure.outcomeUnknown || !(error instanceof ProcessingError));
    if (invoked)
      await database
        .update(usageEvents)
        .set({ status: unknown ? "outcome_unknown" : "failed" })
        .where(
          and(
            eq(usageEvents.attemptId, attempt.id),
            eq(usageEvents.status, "started"),
          ),
        );
    else
      await database
        .update(quotaReservations)
        .set({ status: "released", updatedAt: new Date() })
        .where(
          and(
            eq(quotaReservations.attemptId, attempt.id),
            eq(quotaReservations.status, "reserved"),
          ),
        );
    const retry = !invoked && failure.retryable && task.attempts + 1 < 3;
    const keepVideoCache =
      task.kind === "youtube_refresh" &&
      content.metadataExpiresAt &&
      content.metadataExpiresAt.getTime() > Date.now();
    await finish(
      {
        status: keepVideoCache ? "ready" : retry ? "queued" : "failed",
        failureCode: failure.code,
      },
      retry ? "retry_wait" : "failed",
      unknown ? "outcome_unknown" : "failed",
      failure.code,
    );
    if (retry) throw new Error(failure.code); // pg-boss owns bounded delivery retries.
  } finally {
    releaseSummary?.();
  }
}
