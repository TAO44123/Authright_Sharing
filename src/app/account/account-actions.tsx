"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
export function SignOut() {
  const router = useRouter();
  return (
    <button
      className="secondary"
      onClick={async () => {
        await authClient.signOut();
        router.push("/sign-in");
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
export function RevokeButton({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const result = await fetch(`/api/grants/${id}`, {
              method: "DELETE",
            });
            if (!result.ok) throw new Error();
            router.refresh();
          } catch {
            setError("Unable to revoke. Try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        Revoke connection
      </button>
      <p className="error" role="alert">
        {error}
      </p>
    </>
  );
}
