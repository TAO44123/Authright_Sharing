"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function MemberControls({
  id,
  role,
}: {
  id: string;
  role: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(value: object) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/members/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error?.message ?? "Unable to save member.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save member.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <div className="row">
        <button
          className="secondary"
          disabled={busy}
          onClick={() => save({ role: role === "admin" ? "member" : "admin" })}
        >
          {role === "admin" ? "Make member" : "Make admin"}
        </button>
      </div>
      <p role="alert" className="error">
        {error}
      </p>
    </div>
  );
}
