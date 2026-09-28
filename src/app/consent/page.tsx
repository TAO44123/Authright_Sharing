import { headers } from "next/headers";
import Link from "next/link";
import { auth } from "@/server/auth";
import { webActor } from "@/server/http";
import ConsentButtons from "./consent-buttons";
export const dynamic = "force-dynamic";
export default async function Consent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    for (const item of Array.isArray(value) ? value : value ? [value] : [])
      query.append(key, item);
  let client;
  // The installed provider verifies the signed query through this endpoint.
  // Its internal verifyOAuthQueryParams helper is not a public export in 1.7.6.
  try {
    client = await auth.api.getOAuthClientPublicPrelogin({
      body: {
        client_id: query.get("client_id") ?? "",
        oauth_query: query.toString(),
      },
    });
  } catch {
    return (
      <main>
        <h1>Authorization expired</h1>
        <p>Restart the connection from your client.</p>
        <Link href="/">Back to Sharing</Link>
      </main>
    );
  }
  const h = await headers();
  try {
    await webActor(h);
  } catch {
    return (
      <main>
        <h1>Access unavailable</h1>
        <p>
          Sign in with your company Google account and restart the connection.
        </p>
        <Link href="/sign-in">Sign in to Sharing</Link>
      </main>
    );
  }
  const labels: Record<string, string> = {
    "shares:read": "Read team shares, names, timestamps, and original URLs",
    "shares:write": "Save links and withdraw your own shares",
    "members:read": "Find team members by name or email",
    openid: "Identify your Sharing account",
    profile: "Read your profile name",
    email: "Read your email address",
    offline_access: "Stay connected until you revoke access",
  };
  return (
    <main className="narrow">
      <p className="eyebrow">CONNECT AN AGENT</p>
      <h1>Allow this connection?</h1>
      <section className="panel">
        <h2>{client.client_name ?? "Agent client"}</h2>
        <p className="muted">
          Client identifier: <code>{query.get("client_id")}</code>
        </p>
        <ul className="consent-scopes">
          {(query.get("scope") ?? "")
            .split(" ")
            .filter(Boolean)
            .map((scope) => (
              <li key={scope}>{labels[scope] ?? scope}</li>
            ))}
        </ul>
        {query.get("claims") && (
          <p>
            Additional requested identity claims:{" "}
            <code>{query.get("claims")}</code>
          </p>
        )}
        <p className="muted">
          This client can use only the permissions listed above. Full article
          text, video transcripts, and Google credentials are never included.
          You can revoke this connection in Account.
        </p>
        <p className="muted">
          After you allow access, Sharing opens in a new tab. This tab finishes
          the connection with your agent and can then be closed.
        </p>
        <ConsentButtons />
      </section>
    </main>
  );
}
