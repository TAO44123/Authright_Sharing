import Link from "next/link";
import { config } from "@/server/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Unable to sign in · Authright_Sharing" };

export default async function AuthError({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const expired = [
    "state_not_found",
    "state_mismatch",
    "state_expired",
    "invalid_state",
  ].includes(error ?? "");
  const unavailable = error === "service_unavailable";
  return (
    <main className="narrow">
      <p className="eyebrow">SIGN-IN HELP</p>
      <h1>
        {unavailable
          ? "Sign-in is temporarily unavailable."
          : expired
            ? "Your sign-in link has expired."
            : "We couldn’t complete sign-in."}
      </h1>
      <section className="panel">
        <p role="alert">
          {unavailable
            ? "Please wait a moment, then try signing in again."
            : expired
              ? "Start a new sign-in from Sharing. An old or already used link cannot complete your sign-in."
              : `Sign in with your verified @${config.GOOGLE_WORKSPACE_DOMAIN} Google account. No invitation or administrator approval is needed.`}
        </p>
        <div className="row">
          <Link className="external-link" href="/sign-in">
            Try signing in again →
          </Link>
          <Link href="/">Back to Sharing</Link>
        </div>
      </section>
      <p className="muted">
        If you were connecting an agent, restart the connection from that app
        after signing in.
      </p>
    </main>
  );
}
