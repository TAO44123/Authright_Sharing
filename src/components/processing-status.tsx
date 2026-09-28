import type { z } from "zod";
import type { shareOutput } from "@/contracts";
export type Share = z.infer<typeof shareOutput>;
export function statusLabel(share: Share) {
  if (share.status === "ready") return "Ready";
  if (share.status === "deferred_quota")
    return "Summary paused — usage limit reached";
  if (
    share.failure_code === "SUMMARY_NOT_CONFIGURED" ||
    share.failure_code === "YOUTUBE_NOT_CONFIGURED"
  )
    return "Processing service is not configured";
  if (share.failure_code === "OUTCOME_UNKNOWN")
    return "Summary result unknown — review before retrying";
  if (share.failure_code === "SUMMARY_RATE_LIMITED")
    return "Gemini usage limit reached — retry later";
  if (share.failure_code === "METADATA_EXPIRED") return "Video preview expired";
  if (share.status === "failed")
    return share.type === "youtube"
      ? "Unable to load preview"
      : "Unable to generate summary";
  return share.type === "youtube" ? "Loading preview" : "Generating summary";
}
