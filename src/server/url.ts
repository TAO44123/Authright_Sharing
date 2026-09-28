import { createHash } from "node:crypto";
import ipaddr from "ipaddr.js";
import { AppError } from "./errors.ts";
export function normalizeUrl(input: string) {
  const originalUrl = input.trim();
  if (!originalUrl || Buffer.byteLength(originalUrl) > 8192)
    throw new AppError("INVALID_INPUT", "URL must be at most 8 KiB.");
  let url: URL;
  try {
    url = new URL(originalUrl);
  } catch {
    throw new AppError("INVALID_INPUT", "Enter an HTTP or HTTPS URL.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new AppError(
      "INVALID_INPUT",
      "Enter a public HTTP or HTTPS URL without credentials.",
    );
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (
    (!host.includes(".") && !host.includes(":")) ||
    /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) ||
    (ipaddr.isValid(host) && ipaddr.process(host).range() !== "unicast")
  )
    throw new AppError(
      "INVALID_INPUT",
      "Local and private addresses are not supported.",
    );
  url.hostname = host;
  let videoId: string | null = null;
  if (host === "youtu.be") videoId = url.pathname.slice(1).split("/")[0];
  if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)) {
    if (url.pathname === "/watch") videoId = url.searchParams.get("v");
    else
      videoId =
        /^\/(?:shorts|embed|live)\/([^/]+)/.exec(url.pathname)?.[1] ?? null;
  }
  if (videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId))
    return {
      originalUrl,
      normalizedUrl: `https://www.youtube.com/watch?v=${videoId}`,
      type: "youtube" as const,
      videoId,
      dedupeKey: `youtube:${videoId}`,
    };
  if (
    ["youtu.be", "youtube.com", "www.youtube.com", "m.youtube.com"].includes(
      host,
    )
  )
    throw new AppError(
      "INVALID_INPUT",
      "Enter a link to a specific YouTube video.",
    );
  const normalizedUrl = url.href;
  return {
    originalUrl,
    normalizedUrl,
    type: "article" as const,
    dedupeKey: `article:${createHash("sha256").update(normalizedUrl).digest("hex")}`,
  };
}
