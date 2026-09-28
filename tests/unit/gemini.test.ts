import { expect, it, vi } from "vitest";
import { createGeminiSummary, GEMINI_SUMMARY_MODEL } from "../../src/server/content/gemini.ts";

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
  expect(body.systemInstruction.parts[0].text).toContain("untrusted source data");
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
    version: "gemini-3.5-flash-lite-free-2026-09-27",
    inputPerMillion: "0",
    outputPerMillion: "0",
  });
  expect(createGeminiSummary("key", "paid", send).pricing).toMatchObject({
    version: "gemini-3.5-flash-lite-standard-2026-09-27",
    inputPerMillion: "0.30",
    outputPerMillion: "2.50",
  });
});

it("does not retry a rejected request or a transport failure", async () => {
  const rejected = vi.fn<typeof fetch>(async () => new Response("", { status: 429 }));
  await expect(createGeminiSummary("key", "free", rejected).summarize(request)).rejects.toMatchObject({
    code: "SUMMARY_RATE_LIMITED",
    outcomeUnknown: false,
  });
  expect(rejected).toHaveBeenCalledTimes(1);
  const broken = vi.fn<typeof fetch>(async () => {
    throw new TypeError("socket closed");
  });
  await expect(createGeminiSummary("key", "free", broken).summarize(request)).rejects.toMatchObject({
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
  await expect(createGeminiSummary("key", "free", send).summarize(request)).rejects.toMatchObject({
    code: "SUMMARY_INCOMPLETE_RESPONSE",
    outcomeUnknown: true,
  });
  expect(send).toHaveBeenCalledTimes(1);
});
