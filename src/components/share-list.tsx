import Link from "next/link";
import { statusLabel, type Share } from "./processing-status";

export default function ShareList({
  items,
  timezone,
}: {
  items: Share[];
  timezone: string;
}) {
  return (
    <ul className="list">
      {items.map((share) => (
        <li className="share" key={share.id}>
          <span className="share-icon">
            {share.type === "youtube" ? "VIDEO" : "LINK"}
          </span>
          <div className="share-body">
            <Link className="share-title" href={`/shares/${share.id}`}>
              {share.title ?? share.original_url}
            </Link>
            <p className="share-meta">
              {share.shared_by.name} ·{" "}
              <time dateTime={share.shared_at}>
                {new Date(share.shared_at).toLocaleString("en-US", {
                  timeZone: timezone,
                })}
              </time>
            </p>
            <p className="status-label">{statusLabel(share)}</p>
            {share.excerpt && (
              <>
                <small className="eyebrow">
                  {share.source === "ai_article_summary"
                    ? "AI article summary"
                    : share.source === "ai_video_summary"
                      ? "AI video summary"
                      : "Video description"}
                </small>
                <p className="excerpt">
                  {share.excerpt}
                  {share.truncated ? "…" : ""}
                </p>
              </>
            )}
            <a
              className="source-link"
              href={share.original_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {share.type === "youtube"
                ? "Watch on YouTube ↗"
                : "Open source ↗"}
            </a>
          </div>
          <span className="badge">
            {share.type === "youtube" ? "YouTube" : "Article"}
          </span>
        </li>
      ))}
    </ul>
  );
}
