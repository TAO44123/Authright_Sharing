import type { z } from "zod";
import type { shareOutput } from "@/contracts";
export type Share = z.infer<typeof shareOutput>;
export function statusLabel(share: Share) {
  if (share.status === "ready") return "Ready";
  if (share.status === "queued")
    return share.type === "youtube" ? "Video summary queued" : "Summary queued";
  if (share.status === "processing")
    return share.type === "youtube"
      ? "Generating video summary"
      : "Generating summary";
  if (share.status === "deferred_quota")
    return "Summary paused — usage limit reached";
  if (share.failure_code === "AUDIO_TOOLS_UNAVAILABLE")
    return "Audio processing tools are unavailable";
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
  if (share.failure_code === "VIDEO_UNAVAILABLE")
    return "This video could not be accessed";
  if (share.failure_code === "AUDIO_TOO_LARGE")
    return "Video audio exceeds the processing size limit";
  if (share.failure_code === "AUDIO_UNAVAILABLE")
    return "No downloadable audio was produced";
  if (share.failure_code === "AUDIO_UPLOAD_FAILED")
    return "Audio upload to Gemini failed — retry later";
  if (share.failure_code?.startsWith("AUDIO_"))
    return "Unable to process video audio — retry later";
  if (share.status === "failed") return "Unable to generate summary";
  return share.type === "youtube"
    ? "Generating video summary"
    : "Generating summary";
}
