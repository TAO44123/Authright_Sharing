"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { contracts } from "@/contracts";
import ShareList from "./share-list";
import ProcessingPoll from "./processing-poll";
import type { Share } from "./processing-status";

type Page = { items: Share[]; next_cursor: string | null };
export default function LibraryFeed({
  initial,
  timezone,
}: {
  initial: Page;
  timezone: string;
}) {
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.next_cursor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const load = useCallback(async () => {
    if (!cursor || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/shares?cursor=${encodeURIComponent(cursor)}`,
        {
          cache: "no-store",
          signal: controller.signal,
        },
      );
      const data = await response.json();
      if (!response.ok) {
        if (data.error?.code === "INVALID_CURSOR") {
          setExpired(true);
          throw new Error(
            "This search has expired. Reload the library to continue.",
          );
        }
        throw new Error(
          response.status === 401 || response.status === 403
            ? "Your access has changed. Sign in again to continue."
            : "Unable to load more shares. Please try again.",
        );
      }
      const next = contracts.list_shares.output.parse(data);
      if (controller.signal.aborted) return;
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...next.items.filter((item) => !seen.has(item.id))];
      });
      setCursor(next.next_cursor);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error && !(e.name === "ZodError")
            ? e.message
            : "Unable to load more shares. Please try again.",
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (pending.current === controller) pending.current = null;
    }
  }, [cursor]);
  useEffect(() => {
    if (
      !cursor ||
      error ||
      busy ||
      !sentinel.current ||
      !("IntersectionObserver" in window)
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void load();
      },
      { rootMargin: "120px" },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [cursor, error, busy, load]);
  const update = useCallback((id: string, share: Share | null) => {
    setItems((current) =>
      share
        ? current.map((item) => (item.id === id ? share : item))
        : current.filter((item) => item.id !== id),
    );
  }, []);
  return (
    <>
      {items.length ? (
        <ShareList items={items} timezone={timezone} />
      ) : (
        <div className="empty">
          No matching shares. Try different filters or{" "}
          <Link href="/">share a link</Link>.
        </div>
      )}
      <div
        ref={sentinel}
        className="load-more"
        aria-live="polite"
        aria-busy={busy}
      >
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {expired ? (
          <button onClick={() => window.location.reload()}>
            Reload library
          </button>
        ) : cursor ? (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void load()}
          >
            {busy
              ? "Loading more shares…"
              : error
                ? "Try again"
                : "Load more shares"}
          </button>
        ) : items.length > 0 ? (
          <p className="muted">You’ve reached the end of the library.</p>
        ) : null}
      </div>
      <ProcessingPoll
        ids={items
          .filter((item) => ["queued", "processing"].includes(item.status))
          .map((item) => item.id)}
        onUpdate={update}
      />
    </>
  );
}
