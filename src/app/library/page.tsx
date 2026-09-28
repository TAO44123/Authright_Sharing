import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { webActor } from "@/server/http";
import { listShares, HISTORY_START } from "@/server/shares";
import { accountProfile } from "@/server/account";
import { listMembers } from "@/server/member-search";
import { AppError } from "@/server/errors";
import ShareFilters from "@/components/share-filters";
import LibraryFeed from "@/components/library-feed";
export const dynamic = "force-dynamic";
export default async function Library({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let actor;
  try {
    actor = await webActor(await headers());
  } catch (e) {
    if (e instanceof AppError) redirect("/sign-in");
    throw e;
  }
  const raw = await searchParams;
  const q = Object.fromEntries(
    ["query", "user_id", "from", "to"].map((key) => [
      key,
      typeof raw[key] === "string" ? raw[key] || undefined : undefined,
    ]),
  );
  const [profile, team] = await Promise.all([
    accountProfile(actor),
    listMembers(actor, { limit: 100 }),
  ]);
  let result;
  try {
    result = await listShares(actor, {
      ...q,
      from: q.from ?? HISTORY_START,
      limit: 10,
    });
  } catch (e) {
    if (
      !(e instanceof ZodError) &&
      !(e instanceof AppError && e.code === "INVALID_INPUT")
    )
      throw e;
    return (
      <main>
        <h1>Unable to load these filters.</h1>
        <p>Check your search and date range, then try again.</p>
        <Link href="/library">Reset filters</Link>
      </main>
    );
  }
  const filtered = Object.values(q).some(Boolean);
  const key = JSON.stringify(q);
  return (
    <main>
      <p className="eyebrow">THE TEAM LIBRARY</p>
      <h1>Library.</h1>
      <p className="muted intro">
        Explore everything your team has shared, newest first.
      </p>
      <details open={filtered}>
        <summary>Filter the library</summary>
        <ShareFilters key={key} members={team.members} initial={q} />
      </details>
      <div className="section-top">
        <h2>{filtered ? "Matching shares" : "All shares"}</h2>
        <small className="muted">Newest first · 10 at a time</small>
      </div>
      {(q.from || q.to) && (
        <p className="muted range">
          {q.from
            ? new Date(q.from).toLocaleString("en-US", {
                timeZone: profile.timezone,
              })
            : "Beginning of history"}{" "}
          –{" "}
          {q.to
            ? new Date(q.to).toLocaleString("en-US", {
                timeZone: profile.timezone,
              })
            : "Now"}{" "}
          · {profile.timezone} · End time excluded
        </p>
      )}
      <LibraryFeed key={key} initial={result} timezone={profile.timezone} />
    </main>
  );
}
