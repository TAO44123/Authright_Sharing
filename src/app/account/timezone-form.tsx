"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function TimezoneForm({ timezone }: { timezone: string }) {
  const router = useRouter();
  const [value, setValue] = useState(timezone),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage("");
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          const response = await fetch("/api/account", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ timezone: value }),
          });
          if (!response.ok) throw new Error();
          setMessage("Time zone saved.");
          router.refresh();
        } catch {
          setMessage("Unable to save. Enter a valid IANA time zone.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor="timezone">Display time zone</label>
      <div className="row">
        <input
          id="timezone"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={busy}
          placeholder="America/New_York"
        />
        <button disabled={busy}>Save time zone</button>
        <button
          type="button"
          className="secondary"
          onClick={() =>
            setValue(Intl.DateTimeFormat().resolvedOptions().timeZone)
          }
        >
          Use device zone
        </button>
      </div>
      <p className="muted" role="status">
        {message}
      </p>
    </form>
  );
}
