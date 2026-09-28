import { z } from "zod";
import { ProcessingError } from "./types.ts";
const videoSchema = z.object({
  items: z
    .array(
      z.object({
        snippet: z.object({
          title: z.string().max(2000),
          description: z.string().max(20000).default(""),
          channelTitle: z.string().max(1000),
          thumbnails: z
            .record(z.string(), z.object({ url: z.url() }))
            .default({}),
        }),
        status: z.object({ embeddable: z.boolean() }),
        contentDetails: z.object({ duration: z.string() }).optional(),
      }),
    )
    .max(1),
});
export function parseVideo(input: unknown) {
  const parsed = videoSchema.safeParse(input);
  if (!parsed.success) throw new ProcessingError("INVALID_VIDEO_RESPONSE");
  const item = parsed.data.items[0];
  if (!item) throw new ProcessingError("VIDEO_UNAVAILABLE");
  const image =
    item.snippet.thumbnails.high?.url ??
    item.snippet.thumbnails.default?.url ??
    null;
  const duration = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(
    item.contentDetails?.duration ?? "",
  );
  return {
    title: item.snippet.title,
    videoDescription: item.snippet.description,
    author: item.snippet.channelTitle,
    thumbnailUrl: image?.startsWith("https://") ? image : null,
    embeddable: item.status.embeddable,
    durationSeconds: duration
      ? Number(duration[1] ?? 0) * 3600 +
        Number(duration[2] ?? 0) * 60 +
        Number(duration[3] ?? 0)
      : null,
  };
}
export async function youtubePreview(
  id: string,
  key: string | undefined,
  signal: AbortSignal,
) {
  if (!key) throw new ProcessingError("YOUTUBE_NOT_CONFIGURED");
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.search = new URLSearchParams({
    part: "snippet,contentDetails,status",
    id,
    key,
  }).toString();
  let response: Response;
  try {
    response = await fetch(url, { signal, redirect: "error" });
  } catch {
    throw new ProcessingError("YOUTUBE_FETCH_FAILED", true);
  }
  if (!response.ok)
    throw new ProcessingError(
      "YOUTUBE_API_ERROR",
      response.status === 429 || response.status >= 500,
    );
  const reader = response.body?.getReader();
  if (!reader) throw new ProcessingError("INVALID_VIDEO_RESPONSE");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 1024 * 1024)
        throw new ProcessingError("INVALID_VIDEO_RESPONSE");
      chunks.push(value);
    }
    return parseVideo(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } finally {
    await reader.cancel();
  }
}
