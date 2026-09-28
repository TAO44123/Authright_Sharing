"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
export default function ShareForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const retry = useRef<{ url: string; key: string } | null>(null);
  return (
    <form
      className="panel"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setMessage("");
        setFailed(false);
        const value = url.trim();
        if (retry.current?.url !== value)
          retry.current = { url: value, key: crypto.randomUUID() };
        try {
          const response = await fetch("/api/shares", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url: value,
              idempotency_key: retry.current.key,
            }),
          });
          const data = await response.json();
          if (!response.ok)
            throw new Error(data.error?.message ?? "Unable to share.");
          setMessage(
            data.share.withdrawn
              ? "This earlier submission was withdrawn. Submit again to create a new share."
              : "Shared. Your link is saved.",
          );
          setUrl("");
          retry.current = null;
          router.refresh();
        } catch (error) {
          setFailed(true);
          setMessage(
            error instanceof Error
              ? error.message
              : "Connection lost. Retry to save this link.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor="share-url">Found something worth sharing?</label>
      <div className="row">
        <input
          id="share-url"
          type="url"
          required
          maxLength={8192}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste an article or YouTube link"
          disabled={busy}
        />
        <button disabled={busy}>{busy ? "Saving…" : "Share link"}</button>
      </div>
      <p role="status" className={`status ${failed ? "error" : "muted"}`}>
        {message || "A link is all you need."}
      </p>
    </form>
  );
}
