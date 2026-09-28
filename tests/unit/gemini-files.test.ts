import { expect, it, vi } from "vitest";
import { createGeminiAudio } from "../../src/server/content/gemini.ts";
import { MAX_INLINE_AUDIO_BYTES } from "../../src/server/content/limits.ts";

const origin = "https://generativelanguage.googleapis.com";
const file = {
  name: "files/test-audio",
  uri: `${origin}/v1beta/files/test-audio`,
  state: "ACTIVE",
};
const audio = Buffer.alloc(MAX_INLINE_AUDIO_BYTES + 1);
const notes = {
  language: "en",
  notes: ["A fact from the lecture."],
  uncertainties: [],
};
const result = () =>
  Response.json({
    candidates: [
      {
        finishReason: "STOP",
        content: { parts: [{ text: JSON.stringify(notes) }] },
      },
    ],
    usageMetadata: {
      promptTokenCount: 160000,
      candidatesTokenCount: 500,
      totalTokenCount: 160500,
    },
  });
function transport(state = "ACTIVE") {
  return vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith("/upload/v1beta/files"))
      return new Response(null, {
        headers: {
          "x-goog-upload-url": `${origin}/upload/v1beta/files?upload_id=example`,
        },
      });
    if (String(url).includes("upload_id="))
      return Response.json({ file: { ...file, state } });
    if (init?.method === "DELETE") return new Response(null, { status: 200 });
    if (String(url).endsWith(file.name)) return Response.json(file);
    return result();
  });
}

it("uploads complete large audio, polls readiness, generates once and deletes the remote file", async () => {
  const send = transport("PROCESSING");
  const extracted = await createGeminiAudio("test-key", "free", send).extract({
    audio,
    signal: new AbortController().signal,
  });
  expect(extracted).toMatchObject({
    notes,
    inputTokens: 160000,
    outputTokens: 500,
  });
  const upload = send.mock.calls.find(([url]) =>
    String(url).includes("upload_id="),
  )!;
  expect(upload[1]?.body).toHaveProperty("byteLength", audio.length);
  const generations = send.mock.calls.filter(([url]) =>
    String(url).includes(":generateContent"),
  );
  expect(generations).toHaveLength(1);
  expect(
    JSON.parse(String(generations[0][1]?.body)).contents[0].parts[0],
  ).toEqual({ fileData: { mimeType: "audio/mp3", fileUri: file.uri } });
  expect(send.mock.calls.at(-1)).toMatchObject([
    file.uri,
    { method: "DELETE" },
  ]);
});

it.each(["rejected", "network", "aborted"])(
  "cleans up after %s generation without replay",
  async (failure) => {
    const base = transport();
    const controller = new AbortController();
    const send = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).includes(":generateContent")) {
        if (failure === "rejected") return new Response(null, { status: 503 });
        if (failure === "aborted") controller.abort();
        throw new Error("network");
      }
      if (init?.method === "DELETE") expect(init.signal?.aborted).toBe(false);
      return base(url, init);
    });
    await expect(
      createGeminiAudio("test-key", "free", send).extract({
        audio,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({
      code:
        failure === "rejected"
          ? "SUMMARY_API_ERROR"
          : "SUMMARY_OUTCOME_UNKNOWN",
    });
    expect(
      send.mock.calls.filter(([url]) =>
        String(url).includes(":generateContent"),
      ),
    ).toHaveLength(1);
    expect(send.mock.calls.at(-1)).toMatchObject([
      file.uri,
      { method: "DELETE" },
    ]);
  },
);

it("does not send media or credentials to an unexpected upload host", async () => {
  const send = vi.fn<typeof fetch>(
    async () =>
      new Response(null, {
        headers: { "x-goog-upload-url": "https://example.com/upload/stolen" },
      }),
  );
  await expect(
    createGeminiAudio("test-key", "free", send).extract({
      audio,
      signal: new AbortController().signal,
    }),
  ).rejects.toMatchObject({
    code: "AUDIO_UPLOAD_FAILED",
    outcomeUnknown: false,
  });
  expect(send).toHaveBeenCalledTimes(1);
});

it("deletes failed remote processing without generating", async () => {
  const send = transport("FAILED");
  await expect(
    createGeminiAudio("test-key", "free", send).extract({
      audio,
      signal: new AbortController().signal,
    }),
  ).rejects.toMatchObject({ code: "AUDIO_UPLOAD_FAILED" });
  expect(
    send.mock.calls.some(([url]) => String(url).includes(":generateContent")),
  ).toBe(false);
  expect(send.mock.calls.at(-1)).toMatchObject([
    file.uri,
    { method: "DELETE" },
  ]);
});
