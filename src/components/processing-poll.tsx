"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Share } from "./processing-status";
export default function ProcessingPoll({
  ids,
  onUpdate,
}: {
  ids: string[];
  onUpdate?: (id: string, share: Share | null) => void;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const key = ids.join(",");
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const statuses = await Promise.all(
          key.split(",").map(async (id) => {
            const response = await fetch(`/api/shares/${id}`, {
              cache: "no-store",
              signal: controller.signal,
            });
            if (response.status === 401 || response.status === 403) {
              router.refresh();
              return false;
            }
            if (response.status === 404) {
              if (onUpdate) onUpdate(id, null);
              else router.refresh();
              return false;
            }
            if (!response.ok) throw new Error();
            const share = await response.json();
            if (!["queued", "processing"].includes(share.status)) {
              if (onUpdate) onUpdate(id, share);
              else router.refresh();
            }
            return ["queued", "processing"].includes(share.status);
          }),
        );
        setError("");
        if (statuses.some(Boolean) && !controller.signal.aborted)
          timer = setTimeout(poll, 3000);
      } catch {
        if (!controller.signal.aborted) {
          setError("Status updates are unavailable. Your links are saved.");
          timer = setTimeout(poll, 6000);
        }
      }
    };
    timer = setTimeout(poll, 3000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [key, router, onUpdate]);
  return error ? (
    <p role="status" className="muted">
      {error}
    </p>
  ) : null;
}
