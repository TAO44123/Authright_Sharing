import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_AUDIO_BYTES } from "./limits.ts";
import { ProcessingError } from "./types.ts";

// Fixed executable arguments, no shell, cookies, user configuration or source URL
// supplied by the caller. Child tools receive no application/API credentials.
async function run(
  command: string,
  args: string[],
  signal: AbortSignal,
  code: string,
) {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "ignore"],
      detached: process.platform !== "win32",
      env: { PATH: process.env.PATH, LANG: "C.UTF-8", NODE_ENV: "production" },
    });
    let spawnFailed = false;
    // yt-dlp can skip an oversized download and still exit successfully.
    // Inspect bounded output for this condition without logging media URLs.
    let outputTail = "";
    let tooLarge = false;
    child.stdout?.on("data", (chunk: Buffer) => {
      outputTail = (outputTail + chunk.toString("utf8")).slice(-8192);
      if (outputTail.includes("File is larger than max-filesize"))
        tooLarge = true;
    });
    const abort = () => {
      if (!child.pid) return;
      try {
        if (process.platform === "win32") child.kill("SIGKILL");
        else process.kill(-child.pid, "SIGKILL");
      } catch {
        /* The process may already have exited. */
      }
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.once("error", () => {
      spawnFailed = true;
    });
    child.once("close", (exitCode) => {
      signal.removeEventListener("abort", abort);
      if (spawnFailed) reject(new ProcessingError("AUDIO_TOOLS_UNAVAILABLE"));
      else if (tooLarge) reject(new ProcessingError("AUDIO_TOO_LARGE"));
      else if (signal.aborted)
        reject(new ProcessingError("AUDIO_DOWNLOAD_TIMEOUT"));
      else if (exitCode !== 0) reject(new ProcessingError(code));
      else resolve();
    });
  });
}

export async function downloadYoutubeAudio(
  videoId: string,
  parentSignal: AbortSignal,
  options: { ytDlpPath?: string; ffmpegPath?: string } = {},
): Promise<Buffer> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId))
    throw new ProcessingError("INVALID_VIDEO_ID");
  const folder = await mkdtemp(join(tmpdir(), "sharing-audio-"));
  const limit = new AbortController();
  const signal = AbortSignal.any([
    parentSignal,
    AbortSignal.timeout(300000),
    limit.signal,
  ]);
  // Also bound transfers without a trustworthy Content-Length.
  let checking = false;
  const monitor = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      const sizes = await Promise.all(
        (await readdir(folder)).map(
          async (name) => (await stat(join(folder, name))).size,
        ),
      );
      if (sizes.reduce((sum, size) => sum + size, 0) > 700 * 1024 * 1024)
        limit.abort();
    } catch {
      /* Files may be renamed during a download. */
    } finally {
      checking = false;
    }
  }, 250);
  try {
    await run(
      options.ytDlpPath ?? "yt-dlp",
      [
        "--ignore-config",
        "--no-plugin-dirs",
        "--no-cache-dir",
        "--no-playlist",
        "--no-progress",
        "--no-warnings",
        "--no-js-runtimes",
        "--js-runtimes",
        `node:${process.execPath}`,
        "--no-remote-components",
        "--retries",
        "0",
        "--fragment-retries",
        "0",
        "--extractor-retries",
        "0",
        "--socket-timeout",
        "20",
        "--max-filesize",
        "512M",
        "--match-filters",
        "!is_live",
        "--format",
        "bestaudio[ext=m4a]/bestaudio",
        "--output",
        join(folder, "source.%(ext)s"),
        "--",
        `https://www.youtube.com/watch?v=${videoId}`,
      ],
      signal,
      "AUDIO_DOWNLOAD_FAILED",
    );
    const source = (await readdir(folder)).find((name) =>
      /^source\.(m4a|webm|ogg|mp3|opus)$/.test(name),
    );
    if (!source) throw new ProcessingError("AUDIO_UNAVAILABLE");
    const output = join(folder, "audio.mp3");
    await run(
      options.ffmpegPath ?? "ffmpeg",
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        join(folder, source),
        "-vn",
        "-map",
        "0:a:0",
        "-ac",
        "1",
        "-ar",
        "24000",
        "-codec:a",
        "libmp3lame",
        "-b:a",
        "48k",
        "-y",
        output,
      ],
      signal,
      "AUDIO_CONVERSION_FAILED",
    );
    const { size } = await stat(output);
    if (!size || size > MAX_AUDIO_BYTES)
      throw new ProcessingError("AUDIO_TOO_LARGE");
    return await readFile(output);
  } catch (error) {
    if (limit.signal.aborted) throw new ProcessingError("AUDIO_TOO_LARGE");
    throw error;
  } finally {
    clearInterval(monitor);
    await rm(folder, { recursive: true, force: true });
  }
}
