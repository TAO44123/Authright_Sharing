import { CONTENT_TIMEOUT_MS, CONTENT_LEASE_MS } from "./limits.ts";
import {
  SUMMARY_PROMPT_VERSION,
  VIDEO_PROMPT_VERSION,
} from "./summary-contract.ts";
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
import { reserveQuota, recordInvocation, settleQuota } from "../quota.ts";
import { fetchHtml } from "./fetch.ts";
import { extractArticle } from "./extract.ts";
import { youtubePreview, type parseVideo } from "./youtube.ts";
import {
  ProcessingError,
  type VideoSummaryProvider,
  type ModelUsage,
  type SummaryPricing,
  type SummaryProvider,
} from "./types.ts";

export type ProcessorDependencies = {
  videoSummary?: VideoSummaryProvider;
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
        leaseExpiresAt: new Date(Date.now() + CONTENT_LEASE_MS),
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
    AbortSignal.timeout(CONTENT_TIMEOUT_MS),
    ...(parentSignal ? [parentSignal] : []),
  ]);
  let invoked = false;
  let invocationIndex = 0;
  let previewUpdate: Partial<typeof contents.$inferInsert> = {};
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
  async function saveUsage(
    provider: { model: string; pricing?: SummaryPricing },
    index: number,
    result: ModelUsage,
    status: "succeeded" | "failed",
  ) {
    const cachedTokens = result.usageDetails?.cachedContentTokenCount ?? 0;
    if (
      !Number.isSafeInteger(cachedTokens) ||
      cachedTokens < 0 ||
      (result.inputTokens !== null && cachedTokens > result.inputTokens)
    )
      throw new ProcessingError("INVALID_USAGE");
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
        status,
        usageKnown,
        inputTokens: usageKnown ? result.inputTokens : null,
        outputTokens: usageKnown ? result.outputTokens : null,
        providerRequestId: result.providerRequestId,
        usageDetails: result.usageDetails ?? null,
        model: result.model,
        estimatedAmount:
          usageKnown &&
          provider.pricing &&
          (!cachedTokens ||
            provider.pricing.cachedInputPerMillion !== undefined)
            ? (
                ((result.inputTokens! - cachedTokens) *
                  Number(provider.pricing.inputPerMillion) +
                  cachedTokens *
                    Number(provider.pricing.cachedInputPerMillion ?? 0) +
                  result.outputTokens! *
                    Number(provider.pricing.outputPerMillion)) /
                1_000_000
              ).toFixed(10)
            : null,
      })
      .where(
        and(
          eq(usageEvents.attemptId, attempt.id),
          eq(usageEvents.invocationIndex, index),
        ),
      );
  }
  async function invoke<T extends ModelUsage>(
    provider: { model: string; pricing?: SummaryPricing },
    service: string,
    call: () => Promise<T>,
  ): Promise<T> {
    const index = invocationIndex + 1;
    await database.transaction(async (tx) => {
      const [lease] = await tx
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.id, task.id),
            eq(tasks.leaseToken, token),
            eq(tasks.state, "processing"),
            sql`${tasks.leaseExpiresAt} > now()`,
          ),
        )
        .for("update");
      if (!lease || signal.aborted) throw new ProcessingError("LEASE_LOST");
      await recordInvocation(
        attempt.id,
        provider.model,
        tx,
        provider.pricing,
        index,
        service,
      );
    });
    invocationIndex = index;
    invoked = true;
    let onAbort: (() => void) | undefined;
    let result: T;
    try {
      result = await Promise.race([
        call(),
        new Promise<never>((_, reject) => {
          onAbort = () =>
            reject(new ProcessingError("OUTCOME_UNKNOWN", false, true));
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
    } catch (error) {
      if (error instanceof ProcessingError && error.usage)
        await saveUsage(provider, index, error.usage, "failed");
      throw error;
    } finally {
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
    await saveUsage(provider, index, result, "succeeded");
    return result;
  }
  try {
    let article: { title: string; author: string | null; text: string };
    if (content.type === "youtube") {
      if (!content.videoId || !/^[A-Za-z0-9_-]{11}$/.test(content.videoId))
        throw new ProcessingError("INVALID_VIDEO_ID");
      const preview = await (
        deps.video ??
        ((id, signal) => youtubePreview(id, deps.youtubeKey, signal))
      )(content.videoId, signal);
      previewUpdate = {
        ...preview,
        metadataFetchedAt: new Date(),
        metadataExpiresAt: new Date(Date.now() + 30 * 86400000),
      };
      signal.throwIfAborted();
      // Metadata maintenance never regenerates an existing summary or hides failures.
      if (task.kind === "youtube_refresh") {
        await finish(
          {
            ...previewUpdate,
            status:
              content.failureCode === "METADATA_EXPIRED"
                ? "ready"
                : content.status,
            failureCode:
              content.failureCode === "METADATA_EXPIRED"
                ? null
                : content.failureCode,
          },
          "completed",
          "succeeded",
        );
        return;
      }
      if (!deps.videoSummary?.configured)
        throw new ProcessingError("SUMMARY_NOT_CONFIGURED");
      article = { title: preview.title, author: preview.author, text: "" };
    } else {
      if (!deps.summary.configured)
        throw new ProcessingError("SUMMARY_NOT_CONFIGURED");
      const source = await (deps.fetchArticle ?? fetchHtml)(
        content.originalUrl,
        signal,
      );
      article = (deps.extract ?? extractArticle)(source.html, source.url);
    }
    signal.throwIfAborted();
    await database
      .update(attempts)
      .set({ stage: "summarize" })
      .where(eq(attempts.id, attempt.id));
    releaseSummary = await deps.acquireSummarySlot?.(signal);
    if (!(await reserveQuota(attempt.id, database, new Date(), 1))) {
      await finish(
        {
          ...previewUpdate,
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
    const result =
      content.type === "youtube"
        ? await invoke(deps.videoSummary!, "video_summary", () =>
            deps.videoSummary!.summarize({
              videoId: content.videoId!,
              durationSeconds: previewUpdate.durationSeconds ?? null,
              signal,
            }),
          )
        : await invoke(deps.summary, "summary", () =>
            deps.summary.summarize({
              title: article.title,
              text: article.text,
              sourceType: "article",
              attemptId: attempt.id,
              signal,
            }),
          );
    const parsed = articleSummary.safeParse(result.summary);
    if (!parsed.success) throw new ProcessingError("INVALID_SUMMARY");
    signal.throwIfAborted();
    await finish(
      {
        ...previewUpdate,
        status: "ready",
        title: article.title,
        author: article.author,
        summaryOverview: parsed.data.overview,
        summaryKeyPoints: parsed.data.key_points,
        summaryModel: result.model,
        promptVersion:
          content.type === "youtube"
            ? VIDEO_PROMPT_VERSION
            : SUMMARY_PROMPT_VERSION,
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
    const failureCode = unknown ? "OUTCOME_UNKNOWN" : failure.code;
    const retry = !invoked && failure.retryable && task.attempts + 1 < 3;
    const keepVideoCache =
      task.kind === "youtube_refresh" &&
      content.metadataExpiresAt &&
      content.metadataExpiresAt.getTime() > Date.now();
    await finish(
      {
        ...previewUpdate,
        status:
          task.kind === "youtube_refresh" &&
          (keepVideoCache || content.summaryOverview)
            ? content.status
            : retry
              ? "queued"
              : "failed",
        failureCode,
      },
      retry ? "retry_wait" : "failed",
      unknown ? "outcome_unknown" : "failed",
      failureCode,
    );
    if (retry) throw new Error(failure.code); // pg-boss owns bounded delivery retries.
  } finally {
    releaseSummary?.();
    await settleQuota(attempt.id, database);
  }
}
