"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
export default function ShareFilters({
  members,
  initial,
}: {
  members: { id: string; name: string; email: string; active: boolean }[];
  initial: { query?: string; user_id?: string; from?: string; to?: string };
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  return (
    <form
      className="panel filters"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        const data = new FormData(event.currentTarget);
        const params = new URLSearchParams();
        for (const name of ["query", "user_id", "from", "to"]) {
          const value = String(data.get(name) ?? "").trim();
          if (!value) continue;
          if (name === "from" || name === "to") {
            if (
              !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ||
              !Number.isFinite(Date.parse(value))
            ) {
              setError(
                "Enter ISO dates with a time zone, for example 2026-09-01T00:00:00-04:00.",
              );
              return;
            }
          }
          params.set(name, value);
        }
        router.push(`/library?${params}`);
      }}
    >
      <h2>Find a share</h2>
      <div className="filter-grid">
        <div>
          <label htmlFor="query">Keyword</label>
          <input
            id="query"
            name="query"
            defaultValue={initial.query}
            placeholder="Title, summary, description or URL"
          />
        </div>
        <div>
          <label htmlFor="user_id">Shared by</label>
          <select
            id="user_id"
            name="user_id"
            defaultValue={initial.user_id ?? ""}
          >
            <option value="">Everyone</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name} — {member.email}
                {member.active ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="from">From (inclusive, with time zone)</label>
          <input
            id="from"
            name="from"
            defaultValue={initial.from}
            placeholder="2026-09-01T00:00:00-04:00"
          />
        </div>
        <div>
          <label htmlFor="to">To (exclusive, with time zone)</label>
          <input
            id="to"
            name="to"
            defaultValue={initial.to}
            placeholder="2026-10-01T00:00:00-04:00"
          />
        </div>
      </div>
      <div className="row">
        <button>Apply filters</button>
        <Link href="/library">Reset filters</Link>
      </div>
      <p className="error" role="alert">
        {error}
      </p>
    </form>
  );
}
