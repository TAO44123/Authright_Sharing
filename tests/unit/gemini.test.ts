import { expect, it, vi } from "vitest";
import {
  createGeminiSummary,
  createGeminiAudio,
  createGeminiVideoSummary,
  MAX_AUDIO_BYTES,
  GEMINI_SUMMARY_MODEL,
} from "../../src/server/content/gemini.ts";
import { VIDEO_SUMMARY_TIMEOUT_MS } from "../../src/server/content/limits.ts";

const request = {
  title: "A research article",
  text: "The team measured a faster algorithm and published its findings.",
  attemptId: "attempt-1",
  signal: new AbortController().signal,
};

it("sends one structured Gemini request and counts thinking tokens in billed output", async () => {
  const send = vi.fn<typeof fetch>(async () =>
    Response.json({
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [
              {
                text: JSON.stringify({
                  overview: "Researchers measured a faster algorithm.",
                  key_points: ["One", "Two", "Three"],
                }),
              },
            ],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 1000,
        candidatesTokenCount: 120,
        thoughtsTokenCount: 80,
        totalTokenCount: 1200,
      },
      responseId: "response-1",
    }),
  );
  const provider = createGeminiSummary("private-test-key", "free", send);
  const result = await provider.summarize(request);
  expect(send).toHaveBeenCalledTimes(1);
  const [url, init] = send.mock.calls[0];
  expect(url).toContain(`/models/${GEMINI_SUMMARY_MODEL}:generateContent`);
  expect(url).not.toContain("private-test-key");
  expect(init?.headers).toMatchObject({ "x-goog-api-key": "private-test-key" });
  const body = JSON.parse(String(init?.body));
  expect(body.systemInstruction.parts[0].text).toContain(
    "untrusted source data",
  );
  expect(body.contents[0].parts[0].text).toContain(request.text);
  expect(body.generationConfig.responseMimeType).toBe("application/json");
  expect(body.generationConfig.responseSchema.required).toEqual([
    "overview",
    "key_points",
  ]);
  expect(result).toMatchObject({
    model: GEMINI_SUMMARY_MODEL,
    inputTokens: 1000,
    outputTokens: 200,
    providerRequestId: "response-1",
  });
  expect(provider.pricing).toMatchObject({
    version: "gemini-3.5-flash-lite-free-2026-09-29",
    inputPerMillion: "0",
    outputPerMillion: "0",
  });
  expect(createGeminiSummary("key", "paid", send).pricing).toMatchObject({
    version: "gemini-3.5-flash-lite-standard-2026-09-29",
    inputPerMillion: "0.30",
    outputPerMillion: "2.50",
  });
});

it("does not retry a rejected request or a transport failure", async () => {
  const rejected = vi.fn<typeof fetch>(
    async () => new Response("", { status: 429 }),
  );
  await expect(
    createGeminiSummary("key", "free", rejected).summarize(request),
  ).rejects.toMatchObject({
    code: "SUMMARY_RATE_LIMITED",
    outcomeUnknown: false,
  });
  expect(rejected).toHaveBeenCalledTimes(1);
  const broken = vi.fn<typeof fetch>(async () => {
    throw new TypeError("socket closed");
  });
  await expect(
    createGeminiSummary("key", "free", broken).summarize(request),
  ).rejects.toMatchObject({
    code: "SUMMARY_OUTCOME_UNKNOWN",
    outcomeUnknown: true,
  });
  expect(broken).toHaveBeenCalledTimes(1);
});

it("refuses truncated or malformed model output", async () => {
  const send = vi.fn<typeof fetch>(async () =>
    Response.json({
      candidates: [
        { finishReason: "MAX_TOKENS", content: { parts: [{ text: "{}" }] } },
      ],
    }),
  );
  await expect(
    createGeminiSummary("key", "free", send).summarize(request),
  ).rejects.toMatchObject({
    code: "SUMMARY_INCOMPLETE_RESPONSE",
    outcomeUnknown: true,
  });
  expect(send).toHaveBeenCalledTimes(1);
});

it("extracts only audio notes, ignores thought parts and uses a video-specific summary prompt", async () => {
  const notes = {
    language: "en",
    notes: ["A spoken fact."],
    uncertainties: ["The speaker's name is unclear."],
  };
  const send = vi.fn<typeof fetch>(async () =>
    Response.json({
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [
              { thought: true, text: "private thought" },
              { text: JSON.stringify(notes) },
            ],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 800,
        candidatesTokenCount: 40,
        totalTokenCount: 840,
      },
    }),
  );
  const result = await createGeminiAudio("key", "free", send).extract({
    audio: Buffer.from("audio"),
    signal: request.signal,
  });
  expect(result).toMatchObject({ notes, inputTokens: 800, outputTokens: 40 });
  const body = JSON.parse(String(send.mock.calls[0][1]?.body));
  expect(body.contents[0].parts[0]).toEqual({
    inlineData: {
      mimeType: "audio/mp3",
      data: Buffer.from("audio").toString("base64"),
    },
  });
  expect(body.systemInstruction.parts[0].text).toContain(
    "Do not output timestamps",
  );
  await createGeminiSummary("key", "free", send).summarize({
    ...request,
    sourceType: "youtube",
  });
  const summaryBody = JSON.parse(String(send.mock.calls[1][1]?.body));
  expect(summaryBody.systemInstruction.parts[0].text).toContain(
    "Call the source a video, never an article",
  );
});
it("rejects oversized audio before dispatch and never retries malformed or rejected extraction", async () => {
  const send = vi.fn<typeof fetch>(
    async () => new Response("", { status: 503 }),
  );
  const provider = createGeminiAudio("key", "free", send);
  await expect(
    provider.extract({
      audio: Buffer.alloc(MAX_AUDIO_BYTES + 1),
      signal: request.signal,
    }),
  ).rejects.toMatchObject({ code: "AUDIO_TOO_LARGE" });
  expect(send).not.toHaveBeenCalled();
  await expect(
    provider.extract({ audio: Buffer.from("audio"), signal: request.signal }),
  ).rejects.toMatchObject({ code: "SUMMARY_API_ERROR" });
  expect(send).toHaveBeenCalledTimes(1);
  send.mockImplementation(async () =>
    Response.json({
      candidates: [
        { finishReason: "STOP", content: { parts: [{ text: "{}" }] } },
      ],
    }),
  );
  await expect(
    provider.extract({ audio: Buffer.from("audio"), signal: request.signal }),
  ).rejects.toMatchObject({
    code: "AUDIO_INVALID_NOTES",
    outcomeUnknown: true,
  });
});

const videoRequest = {
  videoId: "0vZ_UVLhSQQ",
  durationSeconds: 240,
  signal: request.signal,
};
function videoResponse(
  data: unknown = {
    available: true,
    overview: "A video overview.",
    key_points: ["One", "Two", "Three"],
  },
  usageMetadata: object = {
    promptTokenCount: 1000,
    candidatesTokenCount: 100,
    totalTokenCount: 1100,
    cachedContentTokenCount: 800,
    promptTokensDetails: [{ modality: "VIDEO", tokenCount: 1000 }],
    cacheTokensDetails: [{ modality: "VIDEO", tokenCount: 800 }],
  },
) {
  return Response.json({
    candidates: [
      {
        finishReason: "STOP",
        content: {
          parts: [
            { thought: true, text: "private thought" },
            { text: JSON.stringify(data) },
          ],
        },
      },
    ],
    usageMetadata,
    responseId: "video-response",
  });
}

it("summarizes a canonical YouTube URL in one non-streaming request and preserves cache usage", async () => {
  const timeout = vi.spyOn(AbortSignal, "timeout");
  const send = vi.fn<typeof fetch>(async () => videoResponse());
  try {
    const result = await createGeminiVideoSummary(
      "key",
      "paid",
      send,
    ).summarize(videoRequest);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatch(/:generateContent$/);
    expect(timeout).toHaveBeenCalledWith(VIDEO_SUMMARY_TIMEOUT_MS);
    const body = JSON.parse(String(send.mock.calls[0][1]?.body));
    expect(body.contents[0].parts[0]).toEqual({
      fileData: { fileUri: "https://www.youtube.com/watch?v=0vZ_UVLhSQQ" },
    });
    expect(body.systemInstruction.parts[0].text).toContain(
      "spoken content and sampled visuals",
    );
    expect(body.generationConfig.responseSchema.required).toEqual([
      "available",
      "overview",
      "key_points",
    ]);
    expect(result).toMatchObject({
      summary: {
        overview: "A video overview.",
        key_points: ["One", "Two", "Three"],
      },
      inputTokens: 1000,
      outputTokens: 100,
      providerRequestId: "video-response",
      usageDetails: {
        cachedContentTokenCount: 800,
        cacheTokensDetails: [{ modality: "VIDEO", tokenCount: 800 }],
      },
    });
    expect(result.summary).not.toHaveProperty("available");
  } finally {
    timeout.mockRestore();
  }
});

it.each([1800, 6617, null])(
  "uses sparse frames for long or unknown duration %s",
  async (durationSeconds) => {
    const send = vi.fn<typeof fetch>(async () => videoResponse());
    await createGeminiVideoSummary("key", "free", send).summarize({
      ...videoRequest,
      durationSeconds,
    });
    const body = JSON.parse(String(send.mock.calls[0][1]?.body));
    expect(body.contents[0].parts[0].videoMetadata).toEqual({ fps: 0.1 });
  },
);

it.each([
  [{ available: false, overview: "", key_points: [] }, "VIDEO_UNAVAILABLE"],
  [
    { available: true, overview: "No supporting points", key_points: [] },
    "INVALID_SUMMARY",
  ],
  [
    { overview: "Missing availability", key_points: ["One", "Two", "Three"] },
    "INVALID_SUMMARY",
  ],
])(
  "refuses unavailable or invalid summaries while retaining known usage",
  async (data, code) => {
    const send = vi.fn<typeof fetch>(async () => videoResponse(data));
    await expect(
      createGeminiVideoSummary("key", "free", send).summarize(videoRequest),
    ).rejects.toMatchObject({
      code,
      outcomeUnknown: false,
      usage: { inputTokens: 1000, outputTokens: 100 },
    });
    expect(send).toHaveBeenCalledTimes(1);
  },
);

it("rejects invalid IDs before dispatch and never retries failed video requests", async () => {
  const send = vi.fn<typeof fetch>(
    async () => new Response("", { status: 429 }),
  );
  const provider = createGeminiVideoSummary("key", "free", send);
  await expect(
    provider.summarize({ ...videoRequest, videoId: "../invalid" }),
  ).rejects.toMatchObject({ code: "INVALID_VIDEO_ID" });
  expect(send).not.toHaveBeenCalled();
  await expect(provider.summarize(videoRequest)).rejects.toMatchObject({
    code: "SUMMARY_RATE_LIMITED",
    outcomeUnknown: false,
  });
  expect(send).toHaveBeenCalledTimes(1);
  send.mockImplementation(async () => {
    throw new TypeError("socket closed");
  });
  await expect(provider.summarize(videoRequest)).rejects.toMatchObject({
    code: "SUMMARY_OUTCOME_UNKNOWN",
    outcomeUnknown: true,
  });
  expect(send).toHaveBeenCalledTimes(2);
});

it("rejects cache tokens exceeding the reported input", async () => {
  const send = vi.fn<typeof fetch>(async () =>
    videoResponse(undefined, {
      promptTokenCount: 100,
      totalTokenCount: 200,
      cachedContentTokenCount: 101,
    }),
  );
  await expect(
    createGeminiVideoSummary("key", "free", send).summarize(videoRequest),
  ).rejects.toMatchObject({ code: "SUMMARY_INVALID_USAGE" });
});
