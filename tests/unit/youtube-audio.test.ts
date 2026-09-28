import { EventEmitter } from "node:events";
import { access, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { downloadYoutubeAudio } from "../../src/server/content/youtube-audio.ts";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
const launch = vi.mocked(spawn);
afterEach(() => vi.resetAllMocks());

it("reports a skipped oversized download even when yt-dlp exits successfully", async () => {
  let folder = "";
  launch.mockImplementation(((_command: string, args: string[]) => {
    folder = dirname(args[args.indexOf("--output") + 1]);
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
    });
    queueMicrotask(() => {
      child.stdout.emit(
        "data",
        Buffer.from("[download] File is larger than max-"),
      );
      child.stdout.emit(
        "data",
        Buffer.from("filesize (107090892 bytes > 104857600 bytes). Aborting."),
      );
      child.emit("close", 0);
    });
    return child;
  }) as typeof spawn);
  await expect(
    downloadYoutubeAudio("58n-n-3oRic", new AbortController().signal),
  ).rejects.toMatchObject({ code: "AUDIO_TOO_LARGE" });
  expect(launch).toHaveBeenCalledTimes(1);
  await expect(access(folder)).rejects.toThrow();
});

it("downloads audio only, converts the full file and deletes temporary files", async () => {
  let folder = "";
  launch.mockImplementation(((_command: string, args: string[]) => {
    const child = new EventEmitter();
    queueMicrotask(async () => {
      const output = args[args.indexOf("--output") + 1];
      if (args.includes("--output")) {
        folder = dirname(output);
        await writeFile(output.replace("%(ext)s", "m4a"), "download");
      } else await writeFile(args.at(-1)!, "converted-mp3");
      child.emit("close", 0);
    });
    return child;
  }) as typeof spawn);
  const result = await downloadYoutubeAudio(
    "0vZ_UVLhSQQ",
    new AbortController().signal,
  );
  expect(result.toString()).toBe("converted-mp3");
  const [command, args, options] = launch.mock.calls[0];
  expect(command).toBe("yt-dlp");
  expect(args).toContain("bestaudio[ext=m4a]/bestaudio");
  expect(args).toContain("--ignore-config");
  expect(args?.at(-1)).toBe("https://www.youtube.com/watch?v=0vZ_UVLhSQQ");
  expect(options).not.toHaveProperty("shell");
  expect(options?.env).not.toHaveProperty("GEMINI_API_KEY");
  expect(launch.mock.calls[1][1]).not.toContain("-t");
  await expect(access(folder)).rejects.toThrow();
});

it("rejects arbitrary URLs without spawning and sanitizes failed tool errors", async () => {
  await expect(
    downloadYoutubeAudio(
      "https://localhost/private",
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "INVALID_VIDEO_ID" });
  expect(launch).not.toHaveBeenCalled();
  let folder = "";
  launch.mockImplementation(((_command: string, args: string[]) => {
    folder = dirname(args[args.indexOf("--output") + 1]);
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("close", 1));
    return child;
  }) as typeof spawn);
  await expect(
    downloadYoutubeAudio("0vZ_UVLhSQQ", new AbortController().signal),
  ).rejects.toMatchObject({ code: "AUDIO_DOWNLOAD_FAILED" });
  await expect(access(folder)).rejects.toThrow();
});
