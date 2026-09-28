// Explicit, opt-in live acceptance run. Keeps six public AI links as ordinary
// shares under the selected company member; rerunning reuses idempotency keys.
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/server/db/index.ts";
import { user } from "../src/server/db/auth-schema.ts";
import { contents, tasks } from "../src/server/db/schema.ts";
import { createGeminiSummary } from "../src/server/content/gemini.ts";
import { readEnv, workerEnvSchema } from "../src/server/env.ts";
import { processContentJob } from "../src/server/content/processor.ts";
import { createSummaryGate } from "../src/server/content/concurrency.ts";
import { getShare, shareLink } from "../src/server/shares.ts";
import { getBoss } from "../src/server/queue.ts";
import { normalizeUrl } from "../src/server/url.ts";

export const samples = [
  "https://deepmind.google/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/",
  "https://blog.google/innovation-and-ai/technology/research/understanding-the-ai-economy/",
  "https://huggingface.co/blog/smolagents",
  "https://www.youtube.com/watch?v=Z8Qip0kgl3A",
  "https://www.youtube.com/watch?v=boJG84Jcf-4",
  "https://www.youtube.com/watch?v=0vZ_UVLhSQQ",
] as const;

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !process.env.GEMINI_API_KEY || !process.env.YOUTUBE_API_KEY)
  throw new Error("Provide a company user email and both A4 API keys.");
const billingTier = readEnv(workerEnvSchema).GEMINI_BILLING_TIER;
if (!billingTier) throw new Error("Set GEMINI_BILLING_TIER before live validation.");

try {
  const [owner] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email));
  if (!owner) throw new Error("The selected company user has not signed in.");
  const actor = {
    userId: owner.id,
    transport: "web" as const,
    scopes: [] as string[],
  };
  const summary = createGeminiSummary(process.env.GEMINI_API_KEY, billingTier);
  const acquireSummarySlot = createSummaryGate(1);
  for (const url of samples) {
    const key = `a4-acceptance-${createHash("sha256").update(url).digest("hex").slice(0, 24)}`;
    const { share } = await shareLink(actor, {
      url,
      idempotency_key: key,
    });
    const [content] = await db
      .select({ id: contents.id })
      .from(contents)
      .where(eq(contents.dedupeKey, normalizeUrl(url).dedupeKey));
    const [task] = await db
      .select({ jobId: tasks.jobId, state: tasks.state })
      .from(tasks)
      .where(eq(tasks.contentId, content.id));
    if (task && ["queued", "retry_wait"].includes(task.state))
      await processContentJob(task.jobId, {
        summary,
        acquireSummarySlot,
        youtubeKey: process.env.YOUTUBE_API_KEY,
      });
    const result = await getShare(actor, share.share_id);
    console.log(
      JSON.stringify({
        type: normalizeUrl(url).type,
        url,
        shareId: share.share_id,
        status: result.processing_status,
        title: result.title,
        failureCode: result.failure_code,
        summaryPoints: result.article_summary?.key_points.length ?? null,
        descriptionLength: result.video_description?.length ?? null,
      }),
    );
  }
} finally {
  const boss = await getBoss();
  await boss.stop({ graceful: true, timeout: 5000 });
  await pool.end();
}
