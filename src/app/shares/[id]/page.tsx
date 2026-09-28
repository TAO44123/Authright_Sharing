import Link from "next/link";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { webActor } from "@/server/http";
import { getShare } from "@/server/shares";
import { accountProfile } from "@/server/account";
import { AppError } from "@/server/errors";
import ShareActions from "@/components/share-actions";
import ProcessingPoll from "@/components/processing-poll";
import { statusLabel } from "@/components/processing-status";
export const dynamic = "force-dynamic";
export default async function ShareDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  let actor;
  try {
    actor = await webActor(await headers());
  } catch {
    redirect("/sign-in");
  }
  const { id } = await params;
  let share;
  try {
    share = await getShare(actor, id);
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
  const profile = await accountProfile(actor);
  const summary = share.article_summary ?? share.video_summary;
  return (
    <main className="detail">
      <Link href="/library">← Back to library</Link>
      <p className="eyebrow">
        {share.type === "youtube" ? "YOUTUBE VIDEO" : "ARTICLE"}
      </p>
      <h1>{share.title ?? "Saved link"}</h1>
      <p className="muted">
        Shared by {share.sharer.name} ·{" "}
        {new Date(share.shared_at).toLocaleString("en-US", {
          timeZone: profile.timezone,
        })}{" "}
        · {profile.timezone}
      </p>
      <p role="status">{statusLabel(share)}</p>
      <a
        className="external-link"
        href={share.original_url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {share.type === "youtube"
          ? "Watch on YouTube ↗"
          : "Read the original article ↗"}
      </a>
      <p className="muted source-url">{share.original_url}</p>
      {summary && (
        <section className="panel">
          <h2>
            {share.type === "youtube"
              ? "AI video summary"
              : "AI article summary"}
          </h2>
          {share.type === "youtube" && (
            <p className="muted">Based on the video’s audio.</p>
          )}
          <p className="overview">{summary.overview}</p>
          <ul>
            {summary.key_points.map((point, i) => (
              <li key={i}>{point}</li>
            ))}
          </ul>
        </section>
      )}
      {share.type === "youtube" && (
        <section className="panel">
          <h2>Video preview</h2>
          {share.author && <p className="muted">{share.author}</p>}
          {share.video_id && share.embeddable && (
            <iframe
              className="video-player"
              title={share.title ?? "YouTube video"}
              src={`https://www.youtube-nocookie.com/embed/${share.video_id}`}
              loading="lazy"
              allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          )}
          <p className="muted">
            If playback is unavailable, use the Watch on YouTube link above.
          </p>
          {share.thumbnail_url && !share.embeddable && (
            <a
              href={share.original_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="video-thumbnail"
                src={share.thumbnail_url}
                alt={share.title ?? "Video preview"}
                referrerPolicy="no-referrer"
              />
            </a>
          )}
          <h2>Video description</h2>
          <p className="description">
            {share.video_description ||
              (share.status === "ready"
                ? "The author did not provide a description."
                : "No video description is available.")}
          </p>
        </section>
      )}
      <p className="scope-note">{share.content_scope_note}</p>
      {share.sharer.id === actor.userId && (
        <ShareActions
          id={share.id}
          canRetry={share.can_retry}
          unknown={share.failure_code === "OUTCOME_UNKNOWN"}
        />
      )}
      <ProcessingPoll
        ids={["queued", "processing"].includes(share.status) ? [share.id] : []}
      />
    </main>
  );
}
