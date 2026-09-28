import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gte, ilike, isNull, lt, or, sql } from "drizzle-orm";
import { fromDrizzle } from "pg-boss";
import { z } from "zod";
import {
  listSharesInput,
  shareLinkInput,
  shareOutput,
  retryShareInput,
} from "../contracts/index.ts";
import { db } from "./db/index.ts";
import { contents, idempotency, shares, tasks } from "./db/schema.ts";
import { user } from "./db/auth-schema.ts";
import { type Actor, authorize } from "./membership.ts";
import { config } from "./config.ts";
import { AppError } from "./errors.ts";
import { CONTENT_QUEUE, getBoss } from "./queue.ts";
import { normalizeUrl } from "./url.ts";
import { displayName } from "./display-name.ts";

const projection = {
  id: shares.id,
  content_id: contents.id,
  original_url: shares.originalUrl,
  createdAt: shares.createdAt,
  userId: user.id,
  name: user.name,
  email: user.email,
  type: contents.type,
  title: contents.title,
  status: contents.status,
  normalized_url: contents.normalizedUrl,
  summaryOverview: contents.summaryOverview,
  summaryKeyPoints: contents.summaryKeyPoints,
  videoDescription: contents.videoDescription,
  video_id: contents.videoId,
  author: contents.author,
  thumbnail_url: contents.thumbnailUrl,
  embeddable: contents.embeddable,
  failure_code: contents.failureCode,
  metadataExpiresAt: contents.metadataExpiresAt,
  withdrawnAt: shares.withdrawnAt,
};
function dto(
  r: {
    id: string;
    content_id: string;
    original_url: string;
    createdAt: Date;
    userId: string;
    name: string;
    email: string;
    type: "article" | "youtube";
    title: string | null;
    status: "queued" | "processing" | "ready" | "failed" | "deferred_quota";
    normalized_url: string;
    summaryOverview: string | null;
    summaryKeyPoints: string[] | null;
    videoDescription: string | null;
    video_id: string | null;
    author: string | null;
    thumbnail_url: string | null;
    embeddable: boolean | null;
    failure_code: string | null;
    metadataExpiresAt: Date | null;
    withdrawnAt: Date | null;
  },
  detail = true,
) {
  const expired =
    r.type === "youtube" &&
    (!r.metadataExpiresAt || r.metadataExpiresAt.getTime() <= Date.now());
  const summary =
    r.status === "ready" && r.summaryOverview && r.summaryKeyPoints
      ? { overview: r.summaryOverview, key_points: r.summaryKeyPoints }
      : null;
  const description =
    r.type === "youtube" && !expired ? r.videoDescription : null;
  const text = summary?.overview ?? description;
  const status =
    expired && !summary && r.status === "ready" ? "failed" : r.status;
  return shareOutput.parse({
    ...r,
    title: expired ? null : r.title,
    author: expired ? null : r.author,
    thumbnail_url: expired ? null : r.thumbnail_url,
    embeddable: expired ? null : r.embeddable,
    id: r.id,
    share_id: r.id,
    shared_at: r.createdAt.toISOString(),
    shared_by: { id: r.userId, name: displayName(r.name, r.email) },
    sharer: { id: r.userId, name: displayName(r.name, r.email) },
    status,
    processing_status: status,
    source: summary
      ? r.type === "youtube"
        ? "ai_video_summary"
        : "ai_article_summary"
      : description !== null
        ? "youtube_description"
        : "none",
    article_summary: detail && r.type === "article" ? summary : null,
    video_summary: detail && r.type === "youtube" ? summary : null,
    video_description: detail ? description : null,
    excerpt: text?.slice(0, 500) ?? null,
    truncated: Boolean(text && text.length > 500),
    failure_code:
      expired && !summary && r.status === "ready"
        ? "METADATA_EXPIRED"
        : r.failure_code,
    can_retry:
      r.status === "failed" ||
      (r.status === "ready" && r.type === "youtube" && !summary),
    withdrawn: Boolean(r.withdrawnAt),
    content_scope_note:
      r.type === "youtube" && summary
        ? "AI summary of the video audio only; visual content is not analyzed. Full audio and transcripts are not stored."
        : "Saved summary or author description only. Full articles and video transcripts are not available; visit the source for further details.",
    full_content_available: false,
  });
}
async function readShare(
  id: string,
  database: Pick<typeof db, "select"> = db,
  includeWithdrawn = false,
) {
  const [row] = await database
    .select(projection)
    .from(shares)
    .innerJoin(contents, eq(contents.id, shares.contentId))
    .innerJoin(user, eq(user.id, shares.userId))
    .where(
      and(
        eq(shares.id, id),
        includeWithdrawn ? undefined : isNull(shares.withdrawnAt),
      ),
    );
  if (!row) throw new AppError("NOT_FOUND", "Share not found.", 404);
  return dto(row);
}
export async function getShare(actor: Actor, id: string) {
  await authorize(actor, "shares:read");
  return readShare(z.uuid().parse(id));
}
export async function shareLink(actor: Actor, input: unknown) {
  const parsed = shareLinkInput.parse(input);
  const normalized = normalizeUrl(parsed.url);
  const fingerprint = createHash("sha256")
    .update(normalized.originalUrl)
    .digest("hex");
  const boss = await getBoss();
  return db.transaction(async (tx) => {
    await authorize(actor, "shares:write", tx);
    // Same actor/key retries serialize before touching content or creating jobs.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${actor.userId + ":share:" + parsed.idempotency_key}, 0))`,
    );
    const [old] = await tx
      .select()
      .from(idempotency)
      .where(
        and(
          eq(idempotency.userId, actor.userId),
          eq(idempotency.operation, "share_link"),
          eq(idempotency.key, parsed.idempotency_key),
        ),
      );
    if (old) {
      if (old.fingerprint !== fingerprint)
        throw new AppError(
          "IDEMPOTENCY_CONFLICT",
          "This retry key was used for a different URL.",
          409,
        );
      return { share: await readShare(old.shareId, tx, true), replayed: true };
    }
    const [created] = await tx
      .insert(contents)
      .values(normalized)
      .onConflictDoNothing()
      .returning();
    const content =
      created ??
      (
        await tx
          .select()
          .from(contents)
          .where(eq(contents.dedupeKey, normalized.dedupeKey))
          .for("update")
      )[0];
    const [share] = await tx
      .insert(shares)
      .values({
        contentId: content.id,
        userId: actor.userId,
        originalUrl: normalized.originalUrl,
      })
      .returning();
    if (created) {
      const jobId = await boss.send(
        CONTENT_QUEUE,
        { contentId: content.id, generation: 1 },
        { db: fromDrizzle(tx, sql) },
      );
      if (!jobId) throw new Error("Content queue rejected job.");
      await tx.insert(tasks).values({ contentId: content.id, jobId });
    }
    await tx.insert(idempotency).values({
      userId: actor.userId,
      operation: "share_link",
      key: parsed.idempotency_key,
      fingerprint,
      shareId: share.id,
    });
    return { share: await readShare(share.id, tx), replayed: false };
  });
}

const cursorSchema = z
  .object({
    v: z.literal(1),
    actor: z.string(),
    from: z.iso.datetime(),
    to: z.iso.datetime(),
    user_id: z.string().optional(),
    keyword: z.string().optional(),
    limit: z.number().int().min(1).max(100),
    lastTime: z.iso.datetime(),
    lastId: z.uuid(),
    expires: z.number(),
  })
  .strict();
function sign(value: string) {
  return createHmac("sha256", config.CURSOR_SIGNING_SECRET)
    .update(value)
    .digest();
}
function encodeCursor(value: z.infer<typeof cursorSchema>) {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${body}.${sign(body).toString("base64url")}`;
}
function decodeCursor(cursor: string) {
  try {
    const [body, signature, extra] = cursor.split(".");
    const expected = sign(body);
    const actual = Buffer.from(signature, "base64url");
    if (
      extra ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    )
      throw new Error();
    const value = cursorSchema.parse(
      JSON.parse(Buffer.from(body, "base64url").toString()),
    );
    if (value.expires < Date.now()) throw new Error();
    return value;
  } catch {
    throw new AppError(
      "INVALID_CURSOR",
      "Pagination expired or changed. Start a new search.",
    );
  }
}
// Web history views request all calendar history; API/MCP keep the seven-day default.
export const HISTORY_START = "0001-01-01T00:00:00.000Z";
export async function listShares(actor: Actor, input: unknown = {}) {
  await authorize(actor, "shares:read");
  const q = listSharesInput.parse(input);
  if (
    (q.user_id && q.sharer_id && q.user_id !== q.sharer_id) ||
    (q.keyword && q.query && q.keyword !== q.query)
  )
    throw new AppError("INVALID_INPUT", "Conflicting filter aliases.");
  q.user_id ??= q.sharer_id;
  q.keyword ??= q.query;
  const cursor = q.cursor ? decodeCursor(q.cursor) : undefined;
  if (
    cursor &&
    (cursor.actor !== actor.userId ||
      ["from", "to", "user_id", "keyword"].some((k) => {
        const key = k as "from" | "to" | "user_id" | "keyword";
        return (
          q[key] !== undefined &&
          (key === "from" || key === "to"
            ? new Date(q[key]!).toISOString()
            : q[key]) !== cursor[key]
        );
      }))
  )
    throw new AppError(
      "INVALID_CURSOR",
      "Cursor filters do not match this search.",
    );
  const to =
    cursor?.to ??
    (q.to ? new Date(q.to).toISOString() : new Date().toISOString());
  const from =
    cursor?.from ??
    (q.from
      ? new Date(q.from).toISOString()
      : new Date(new Date(to).getTime() - 7 * 86400000).toISOString());
  if (from >= to)
    throw new AppError("INVALID_INPUT", "From must be before to.");
  const filters = {
    from,
    to,
    user_id: cursor?.user_id ?? q.user_id,
    keyword: cursor?.keyword ?? q.keyword,
    limit: cursor?.limit ?? q.limit,
  };
  const escaped = filters.keyword?.replace(/[\\%_]/g, "\\$&");
  const rows = await db
    .select(projection)
    .from(shares)
    .innerJoin(contents, eq(contents.id, shares.contentId))
    .innerJoin(user, eq(user.id, shares.userId))
    .where(
      and(
        isNull(shares.withdrawnAt),
        gte(shares.createdAt, new Date(from)),
        lt(shares.createdAt, new Date(to)),
        filters.user_id ? eq(shares.userId, filters.user_id) : undefined,
        escaped
          ? or(
              ilike(shares.originalUrl, `%${escaped}%`),
              ilike(contents.summaryOverview, `%${escaped}%`),
              sql`${contents.summaryKeyPoints}::text ilike ${`%${escaped}%`}`,
              and(
                or(
                  eq(contents.type, "article"),
                  sql`${contents.metadataExpiresAt} > now()`,
                ),
                or(
                  ilike(contents.title, `%${escaped}%`),
                  ilike(contents.videoDescription, `%${escaped}%`),
                ),
              ),
            )
          : undefined,
        cursor
          ? or(
              lt(shares.createdAt, new Date(cursor.lastTime)),
              and(
                eq(shares.createdAt, new Date(cursor.lastTime)),
                lt(shares.id, cursor.lastId),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(shares.createdAt), desc(shares.id))
    .limit(filters.limit + 1);
  const page = rows.slice(0, filters.limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => dto(row, false)),
    from,
    to,
    next_cursor:
      rows.length > filters.limit && last
        ? encodeCursor({
            v: 1,
            actor: actor.userId,
            ...filters,
            lastId: last.id,
            lastTime: last.createdAt.toISOString(),
            expires: cursor?.expires ?? Date.now() + 3600000,
          })
        : null,
  };
}

export async function withdrawShare(actor: Actor, id: string) {
  z.uuid().parse(id);
  return db.transaction(async (tx) => {
    await authorize(actor, "shares:write", tx);
    const [row] = await tx
      .update(shares)
      .set({ withdrawnAt: sql`coalesce(${shares.withdrawnAt}, now())` })
      .where(and(eq(shares.id, id), eq(shares.userId, actor.userId)))
      .returning({ id: shares.id });
    if (!row) throw new AppError("NOT_FOUND", "Share not found.", 404);
    return { share_id: id, withdrawn: true as const };
  });
}
export async function retryShare(actor: Actor, id: string, input: unknown) {
  z.uuid().parse(id);
  const q = retryShareInput.parse(input);
  const boss = await getBoss();
  return db.transaction(async (tx) => {
    await authorize(actor, "shares:write", tx);
    const [share] = await tx
      .select()
      .from(shares)
      .where(
        and(
          eq(shares.id, id),
          eq(shares.userId, actor.userId),
          isNull(shares.withdrawnAt),
        ),
      )
      .for("update");
    if (!share) throw new AppError("NOT_FOUND", "Share not found.", 404);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${actor.userId + ":retry:" + q.idempotency_key}, 0))`,
    );
    const [old] = await tx
      .select()
      .from(idempotency)
      .where(
        and(
          eq(idempotency.userId, actor.userId),
          eq(idempotency.operation, "retry_share"),
          eq(idempotency.key, q.idempotency_key),
        ),
      );
    if (old) {
      if (old.shareId !== id)
        throw new AppError(
          "IDEMPOTENCY_CONFLICT",
          "This key belongs to another retry.",
          409,
        );
      return { share: await readShare(id, tx), replayed: true };
    }
    const [content] = await tx
      .select()
      .from(contents)
      .where(eq(contents.id, share.contentId))
      .for("update");
    if (
      content.status !== "failed" &&
      !(
        content.status === "ready" &&
        content.type === "youtube" &&
        !content.summaryOverview
      )
    )
      throw new AppError(
        "CONFLICT",
        "Only failed content or videos without an audio summary can be processed.",
        409,
      );
    const previous = await tx
      .select()
      .from(tasks)
      .where(eq(tasks.contentId, content.id))
      .orderBy(desc(tasks.generation), desc(tasks.createdAt));
    if (
      previous.some((t) =>
        ["queued", "processing", "retry_wait", "deferred_quota"].includes(
          t.state,
        ),
      )
    )
      throw new AppError("CONFLICT", "Processing is already active.", 409);
    if (
      previous.some((t) => t.retryAfter && t.retryAfter.getTime() > Date.now())
    )
      throw new AppError(
        "RATE_LIMITED",
        "Please wait 60 seconds after a failed attempt before retrying.",
        429,
      );
    const generation = (previous[0]?.generation ?? 0) + 1;
    const jobId = await boss.send(
      CONTENT_QUEUE,
      { contentId: content.id, generation, version: 1 },
      { db: fromDrizzle(tx, sql) },
    );
    if (!jobId) throw new Error("Queue rejected retry");
    await tx.insert(tasks).values({
      contentId: content.id,
      generation,
      jobId,
      retryAfter: new Date(Date.now() + 60000),
    });
    await tx
      .update(contents)
      .set({ status: "queued", failureCode: null, updatedAt: new Date() })
      .where(eq(contents.id, content.id));
    await tx.insert(idempotency).values({
      userId: actor.userId,
      operation: "retry_share",
      key: q.idempotency_key,
      fingerprint: id,
      shareId: id,
    });
    return { share: await readShare(id, tx), replayed: false };
  });
}
