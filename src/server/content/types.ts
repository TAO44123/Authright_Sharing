import type { z } from "zod";
import type { articleSummary } from "../../contracts/index.ts";
export class ProcessingError extends Error {
  constructor(
    public code: string,
    public retryable = false,
    public outcomeUnknown = false,
  ) {
    super(code);
  }
}
export type ModelUsage = {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  providerRequestId?: string;
};
export type SummaryResult = ModelUsage & {
  summary: z.infer<typeof articleSummary>;
};
export type AudioNotes = {
  language: string;
  notes: string[];
  uncertainties: string[];
};
export interface AudioProvider {
  readonly configured: boolean;
  readonly model: string;
  readonly pricing?: SummaryPricing;
  extract(input: {
    audio: Buffer;
    signal: AbortSignal;
  }): Promise<ModelUsage & { notes: AudioNotes }>;
}
export type SummaryPricing = {
  version: string;
  currency: "USD";
  inputPerMillion: string;
  outputPerMillion: string;
};
export interface SummaryProvider {
  readonly configured: boolean;
  readonly model: string;
  readonly pricing?: SummaryPricing;
  summarize(input: {
    sourceType?: "article" | "youtube";
    title: string;
    text: string;
    attemptId: string;
    signal: AbortSignal;
  }): Promise<SummaryResult>;
}
// Missing credentials never produce a fabricated summary.
export const unconfiguredSummary: SummaryProvider = {
  configured: false,
  model: "unconfigured",
  async summarize() {
    throw new ProcessingError("SUMMARY_NOT_CONFIGURED");
  },
};
