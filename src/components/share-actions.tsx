"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
export default function ShareActions({
  id,
  canRetry,
  unknown,
}: {
  id: string;
  canRetry: boolean;
  unknown: boolean;
}) {
  const router = useRouter();
  const key = useRef<string | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  async function action(retry: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      key.current ??= crypto.randomUUID();
      const response = await fetch(
        `/api/shares/${id}${retry ? "/retry" : ""}`,
        {
          method: retry ? "POST" : "DELETE",
          headers: { "Content-Type": "application/json" },
          ...(retry
            ? { body: JSON.stringify({ idempotency_key: key.current }) }
            : {}),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error?.message ?? "Unable to update this share.");
      if (!retry) router.push("/");
      key.current = null;
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection lost. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Your share</h2>
      {unknown && (
        <p className="error">
          The previous model request may have been charged. Retrying starts
          another request.
        </p>
      )}
      <div className="row">
        {canRetry && (
          <button disabled={busy} onClick={() => action(true)}>
            {busy ? "Working…" : "Retry processing"}
          </button>
        )}
        {confirmWithdraw ? (
          <>
            <button disabled={busy} onClick={() => action(false)}>
              Confirm withdrawal
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setConfirmWithdraw(false)}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => setConfirmWithdraw(true)}
          >
            Withdraw my share
          </button>
        )}
      </div>
      <p className="muted">
        Withdrawing removes your record. Other people’s shares remain available.
      </p>
      <p role="alert" className="error">
        {error}
      </p>
    </section>
  );
}
