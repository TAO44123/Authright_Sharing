import { googleConfigured, config } from "@/server/config";
import SignInButton from "./sign-in-button";
export const dynamic = "force-dynamic";
export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = await searchParams;
  return (
    <main>
      <div className="intro">
        <p className="eyebrow">
          A LITTLE LESS SCROLLING. A LITTLE MORE SHARING.
        </p>
        <h1>
          Your team’s next
          <br />
          good read.
        </h1>
        <p className="muted">
          A quiet place for useful links, ideas, and things worth passing on.
        </p>
      </div>
      <section className="panel narrow">
        <h2>Welcome to Sharing</h2>
        <p className="muted">
          Sign in with your {config.GOOGLE_WORKSPACE_DOMAIN} Google account.
          Everyone with a verified company account can join automatically.
        </p>
        {q.error && (
          <p className="error" role="alert">
            Sign-in was not completed. Use your verified @
            {config.GOOGLE_WORKSPACE_DOMAIN} Google account and try again.
          </p>
        )}
        {googleConfigured ? (
          <SignInButton />
        ) : (
          <p role="status">
            Google sign-in is awaiting local configuration. Ask your
            administrator to finish setup.
          </p>
        )}
      </section>
    </main>
  );
}
