"use client";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
export default function SignInButton() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const result = await authClient.signIn.social({
              provider: "google",
              callbackURL: "/",
              errorCallbackURL: "/auth-error",
            });
            if (result.error)
              setError(
                "Sign-in failed. Check your account access and try again.",
              );
          } catch {
            setError("Unable to connect. Please try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        Continue with Google
      </button>
      <p role="alert" className="error">
        {error}
      </p>
    </>
  );
}
