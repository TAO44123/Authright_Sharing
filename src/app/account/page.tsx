import Link from "next/link";
import TimezoneForm from "./timezone-form";
import { accountProfile } from "@/server/account";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { webActor } from "@/server/http";
import { db } from "@/server/db";
import { agentGrants } from "@/server/db/schema";
import { RevokeButton, SignOut } from "./account-actions";
export const dynamic = "force-dynamic";
export default async function Account() {
  let actor;
  try {
    actor = await webActor(await headers());
  } catch {
    redirect("/sign-in");
  }
  const profile = await accountProfile(actor);
  const grants = await db
    .select()
    .from(agentGrants)
    .where(eq(agentGrants.userId, actor.userId))
    .orderBy(desc(agentGrants.createdAt));
  return (
    <main className="narrow">
      <p className="eyebrow">YOUR ACCOUNT</p>
      <h1>Your Sharing account.</h1>
      <p>
        {profile.name} · {profile.email}
      </p>
      {profile.role === "admin" && <Link href="/admin">Manage members →</Link>}
      <section className="panel">
        <TimezoneForm timezone={profile.timezone} />
      </section>
      <h2>Connected agents</h2>
      <p className="muted">
        Revoking a connection immediately blocks its existing access and refresh
        tokens. Your Sharing web session stays signed in.
      </p>
      <section className="panel">
        {grants.length ? (
          <ul className="grants">
            {grants.map((g) => (
              <li key={g.id}>
                <p>
                  <strong>Client</strong> <code>{g.clientId}</code>
                  <br />
                  <small>
                    {g.revokedAt ? "Revoked" : "Connected"}{" "}
                    {(g.revokedAt ?? g.createdAt).toISOString()}
                  </small>
                </p>
                {g.revokedAt ? (
                  <p className="muted">
                    Access revoked. Reconnect from your agent to allow access
                    again.
                  </p>
                ) : (
                  <RevokeButton id={g.id} />
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No connected agents yet.</p>
        )}
      </section>
      <section className="panel">
        <h2>Reconnect an agent</h2>
        <ol className="consent-scopes">
          <li>
            Try Sharing in your agent. If an authorization prompt appears, open
            it.
          </li>
          <li>
            If no prompt appears, open the agent’s MCP connection settings and
            start authentication for Sharing.
          </li>
          <li>
            On the Sharing authorization page, review the permissions and choose
            Allow access. Then retry your request.
          </li>
        </ol>
        <p className="muted">
          You do not need to sign out of Sharing. Previously revoked credentials
          remain invalid after reconnecting.
        </p>
      </section>
      <SignOut />
    </main>
  );
}
