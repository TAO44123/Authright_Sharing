"use client";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
export default function ConsentButtons() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(accept: boolean) {
    // Open during the click gesture so browsers do not block the Sharing tab.
    // The current tab must still visit the OAuth client's loopback callback.
    const sharingTab = accept ? window.open("/", "_blank") : null;
    setBusy(true);
    setError("");
    try {
      const { data, error } = await authClient.oauth2.consent({ accept });
      if (error || !data?.url) throw new Error();
      window.location.assign(data.url);
    } catch {
      sharingTab?.close();
      setError(
        "Authorization could not be completed. Restart the connection from your client.",
      );
      setBusy(false);
    }
  }
  return (
    <>
      <div className="row">
        <button disabled={busy} onClick={() => submit(true)}>
          Allow access
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => submit(false)}
        >
          Deny
        </button>
      </div>
      <p role="alert" className="error">
        {error}
      </p>
    </>
  );
}
