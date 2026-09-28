import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { webActor } from "@/server/http";
import { listShares, HISTORY_START } from "@/server/shares";
import { accountProfile } from "@/server/account";
import { AppError } from "@/server/errors";
import ShareForm from "./share-form";
import ShareList from "@/components/share-list";
import ProcessingPoll from "@/components/processing-poll";
export const dynamic = "force-dynamic";
export default async function Home() {
  let actor;
  try {
    actor = await webActor(await headers());
  } catch (e) {
    if (e instanceof AppError) redirect("/sign-in");
    throw e;
  }
  const [profile, result] = await Promise.all([
    accountProfile(actor),
    listShares(actor, { from: HISTORY_START, limit: 5 }),
  ]);
  return (
    <main>
      <p className="eyebrow">SHARE WITH YOUR TEAM</p>
      <h1>Worth passing on.</h1>
      <p className="muted intro">
        A shared collection of ideas, perspectives, and useful discoveries.
      </p>
      {profile.role === "admin" && <Link href="/admin">Manage members →</Link>}
      <ShareForm />
      <div className="section-top">
        <h2>Recent shares</h2>
        <small className="muted">Latest 5 · Newest first</small>
      </div>
      {result.items.length ? (
        <ShareList items={result.items} timezone={profile.timezone} />
      ) : (
        <div className="empty">
          No shares yet. Share a link to start the collection.
        </div>
      )}
      <Link className="page-link" href="/library">
        View all shares →
      </Link>
      <ProcessingPoll
        ids={result.items
          .filter((s) => ["queued", "processing"].includes(s.status))
          .map((s) => s.id)}
      />
    </main>
  );
}
