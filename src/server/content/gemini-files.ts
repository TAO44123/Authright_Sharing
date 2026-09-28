import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { logger } from "../logger.ts";
import { ProcessingError } from "./types.ts";
import { MAX_AUDIO_BYTES, MAX_INLINE_AUDIO_BYTES } from "./limits.ts";

const origin = "https://generativelanguage.googleapis.com";
const fileSchema = z.object({
  name: z.string().regex(/^files\/[a-zA-Z0-9_-]+$/),
  uri: z.string().url(),
  state: z.enum(["PROCESSING", "ACTIVE", "FAILED"]),
});
type AudioPart =
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { mimeType: string; fileUri: string } };

async function json(response: Response): Promise<unknown> {
  if (!response.ok || !response.body)
    throw new ProcessingError("AUDIO_UPLOAD_FAILED");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65536) throw new ProcessingError("AUDIO_UPLOAD_FAILED");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

// Large media is uploaded once and referenced by URI. Cleanup also runs after
// model rejection or cancellation, with its own deadline independent of the job.
export async function withGeminiAudio<T>(
  key: string,
  audio: Buffer,
  signal: AbortSignal,
  send: typeof fetch,
  consume: (part: AudioPart) => Promise<T>,
): Promise<T> {
  if (!audio.length || audio.length > MAX_AUDIO_BYTES)
    throw new ProcessingError("AUDIO_TOO_LARGE");
  if (audio.length <= MAX_INLINE_AUDIO_BYTES)
    return consume({
      inlineData: { mimeType: "audio/mp3", data: audio.toString("base64") },
    });
  const uploadSignal = AbortSignal.any([signal, AbortSignal.timeout(180000)]);
  let name: string | undefined;
  try {
    let file: z.infer<typeof fileSchema>;
    try {
      const start = await send(`${origin}/upload/v1beta/files`, {
        method: "POST",
        redirect: "error",
        signal: uploadSignal,
        headers: {
          "x-goog-api-key": key,
          "Content-Type": "application/json",
          "X-Goog-Upload-Protocol": "resumable",
          "X-Goog-Upload-Command": "start",
          "X-Goog-Upload-Header-Content-Length": String(audio.length),
          "X-Goog-Upload-Header-Content-Type": "audio/mp3",
        },
        body: JSON.stringify({ file: { display_name: "sharing-audio" } }),
      });
      const location = start.headers.get("x-goog-upload-url");
      await start.body?.cancel();
      if (!start.ok || !location)
        throw new ProcessingError("AUDIO_UPLOAD_FAILED");
      const url = new URL(location);
      if (
        url.origin !== origin ||
        !url.pathname.startsWith("/upload/") ||
        url.username ||
        url.password
      )
        throw new ProcessingError("AUDIO_UPLOAD_FAILED");
      const uploaded = await json(
        await send(url.href, {
          method: "POST",
          redirect: "error",
          signal: uploadSignal,
          headers: {
            "Content-Type": "audio/mp3",
            "Content-Length": String(audio.length),
            "X-Goog-Upload-Offset": "0",
            "X-Goog-Upload-Command": "upload, finalize",
          },
          body: new Uint8Array(audio),
        }),
      );
      // Capture a valid name before full validation so malformed metadata can
      // still be deleted without trusting arbitrary provider-returned URLs.
      name = z.object({ file: fileSchema.pick({ name: true }) }).parse(uploaded)
        .file.name;
      file = z.object({ file: fileSchema }).parse(uploaded).file;
      while (file.state === "PROCESSING") {
        await delay(1000, undefined, { signal: uploadSignal });
        file = fileSchema.parse(
          await json(
            await send(`${origin}/v1beta/${name}`, {
              redirect: "error",
              signal: uploadSignal,
              headers: { "x-goog-api-key": key },
            }),
          ),
        );
        if (file.name !== name)
          throw new ProcessingError("AUDIO_UPLOAD_FAILED");
      }
      if (file.state !== "ACTIVE" || file.uri !== `${origin}/v1beta/${name}`)
        throw new ProcessingError("AUDIO_UPLOAD_FAILED");
    } catch {
      // File preparation does not issue a generation request.
      throw new ProcessingError("AUDIO_UPLOAD_FAILED");
    }
    return await consume({
      fileData: { mimeType: "audio/mp3", fileUri: file.uri },
    });
  } finally {
    if (name) {
      try {
        const removed = await send(`${origin}/v1beta/${name}`, {
          method: "DELETE",
          redirect: "error",
          signal: AbortSignal.timeout(10000),
          headers: { "x-goog-api-key": key },
        });
        await removed.body?.cancel();
        if (!removed.ok && removed.status !== 404) throw new Error("cleanup");
      } catch {
        // Files API expires leftovers after 48 hours; never replay generation
        // because deletion failed. No URI, source data, or credential is logged.
        logger.warn({ event: "audio_file_cleanup_failed" });
      }
    }
  }
}
