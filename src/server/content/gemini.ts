import { z } from "zod";
import { summaryMessages } from "./summary-contract.ts";
import { ProcessingError, type SummaryProvider } from "./types.ts";

export const GEMINI_SUMMARY_MODEL = "gemini-3.5-flash-lite";
export type GeminiBillingTier = "free" | "paid";
// Free-tier text input/output is free; its project-level rate limits still apply.
export const GEMINI_SUMMARY_FREE_PRICING = {
  version: "gemini-3.5-flash-lite-free-2026-09-27",
  currency: "USD" as const,
  inputPerMillion: "0",
  outputPerMillion: "0",
};
// Standard paid text pricing, USD per 1M tokens, checked 2026-09-27.
// https://ai.google.dev/gemini-api/docs/pricing
export const GEMINI_SUMMARY_PAID_PRICING = {
  version: "gemini-3.5-flash-lite-standard-2026-09-27",
  currency: "USD" as const,
  inputPerMillion: "0.30",
  outputPerMillion: "2.50",
};

const tokenCount = z.number().int().nonnegative();
const responseSchema = z.object({
  candidates: z
    .array(
      z.object({
        finishReason: z.string().optional(),
        content: z
          .object({ parts: z.array(z.object({ text: z.string().optional() })) })
          .optional(),
      }),
    )
    .optional(),
  usageMetadata: z
    .object({
      promptTokenCount: tokenCount.optional(),
      candidatesTokenCount: tokenCount.optional(),
      thoughtsTokenCount: tokenCount.optional(),
      totalTokenCount: tokenCount.optional(),
    })
    .optional(),
  responseId: z.string().max(500).optional(),
});

async function readLimitedJson(response: Response) {
  if (!response.body) throw new ProcessingError("SUMMARY_INVALID_RESPONSE", false, true);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 1024 * 1024)
        throw new ProcessingError("SUMMARY_RESPONSE_TOO_LARGE", false, true);
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof ProcessingError) throw error;
    throw new ProcessingError("SUMMARY_INVALID_RESPONSE", false, true);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export function createGeminiSummary(
  key: string,
  billingTier: GeminiBillingTier,
  send: typeof fetch = fetch,
): SummaryProvider {
  return {
    configured: Boolean(key.trim()),
    model: GEMINI_SUMMARY_MODEL,
    pricing:
      billingTier === "free"
        ? GEMINI_SUMMARY_FREE_PRICING
        : GEMINI_SUMMARY_PAID_PRICING,
    async summarize({ title, text, signal }) {
      if (!key.trim()) throw new ProcessingError("SUMMARY_NOT_CONFIGURED");
      const [system, user] = summaryMessages(title, text);
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(90000)]);
      let response: Response;
      try {
        // Native fetch performs one HTTP request; no SDK retry can spend again.
        response = await send(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_SUMMARY_MODEL}:generateContent`,
          {
            method: "POST",
            redirect: "error",
            signal: requestSignal,
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": key,
            },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: system.content }] },
              contents: [{ role: "user", parts: [{ text: user.content }] }],
              generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                  type: "OBJECT",
                  properties: {
                    overview: { type: "STRING" },
                    key_points: {
                      type: "ARRAY",
                      items: { type: "STRING" },
                      minItems: 3,
                      maxItems: 5,
                    },
                  },
                  required: ["overview", "key_points"],
                },
                candidateCount: 1,
                maxOutputTokens: 2048,
              },
            }),
          },
        );
      } catch {
        // After the request starts, a network/timeout error cannot prove whether
        // Google billed or generated content. The processor must not replay it.
        throw new ProcessingError("SUMMARY_OUTCOME_UNKNOWN", false, true);
      }
      if (!response.ok)
        throw new ProcessingError(
          response.status === 400 || response.status === 404
            ? "SUMMARY_REQUEST_REJECTED"
            : response.status === 401 || response.status === 403
              ? "SUMMARY_AUTH_FAILED"
              : response.status === 429
                ? "SUMMARY_RATE_LIMITED"
                : "SUMMARY_API_ERROR",
        );
      const parsed = responseSchema.safeParse(await readLimitedJson(response));
      if (!parsed.success)
        throw new ProcessingError("SUMMARY_INVALID_RESPONSE", false, true);
      const candidate = parsed.data.candidates?.[0];
      if (!candidate || candidate.finishReason !== "STOP")
        throw new ProcessingError("SUMMARY_INCOMPLETE_RESPONSE", false, true);
      const output = candidate.content?.parts
        .map((part) => part.text ?? "")
        .join("")
        .trim();
      if (!output)
        throw new ProcessingError("SUMMARY_EMPTY_RESPONSE", false, true);
      let summary: unknown;
      try {
        summary = JSON.parse(output);
      } catch {
        throw new ProcessingError("SUMMARY_INVALID_RESPONSE", false, true);
      }
      const usage = parsed.data.usageMetadata;
      const inputTokens = usage?.promptTokenCount ?? null;
      const outputTokens =
        usage?.totalTokenCount !== undefined && inputTokens !== null
          ? usage.totalTokenCount - inputTokens
          : usage?.candidatesTokenCount !== undefined
            ? usage.candidatesTokenCount + (usage.thoughtsTokenCount ?? 0)
            : null;
      if (outputTokens !== null && outputTokens < 0)
        throw new ProcessingError("SUMMARY_INVALID_USAGE", false, true);
      return {
        summary: summary as Awaited<ReturnType<SummaryProvider["summarize"]>>["summary"],
        model: GEMINI_SUMMARY_MODEL,
        inputTokens,
        outputTokens,
        providerRequestId: parsed.data.responseId,
      };
    },
  };
}
