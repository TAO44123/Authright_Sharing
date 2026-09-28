import { z } from "zod";
export const scopeSchema = z.enum([
  "shares:read",
  "shares:write",
  "members:read",
]);
export const errorCodeSchema = z.enum([
  "CONFLICT",
  "RATE_LIMITED",
  "INVALID_INPUT",
  "UNAUTHENTICATED",
  "MEMBER_DISABLED",
  "FORBIDDEN",
  "GRANT_REVOKED",
  "NOT_FOUND",
  "IDEMPOTENCY_CONFLICT",
  "INVALID_CURSOR",
  "INTERNAL_ERROR",
]);
export const shareLinkInput = z
  .object({
    url: z.string().trim().min(1).max(8192),
    idempotency_key: z.string().min(8).max(128),
  })
  .strict();
export const listSharesInput = z
  .object({
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    limit: z.number().int().min(1).max(100).default(20),
    cursor: z.string().max(4096).optional(),
    user_id: z.string().min(1).max(128).optional(),
    sharer_id: z.string().min(1).max(128).optional(),
    query: z.string().trim().min(1).max(200).optional(),
    keyword: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export const getShareInput = z.object({ share_id: z.uuid() }).strict();
export const withdrawShareInput = getShareInput;
export const listMembersInput = z
  .object({
    query: z.string().trim().max(200).optional(),
    limit: z.number().int().min(1).max(100).default(20),
    cursor: z.string().max(4096).optional(),
  })
  .strict();
export const articleSummary = z.object({
  overview: z.string().min(1).max(1200),
  key_points: z.array(z.string().min(1).max(1000)).min(3).max(5),
});
export const retryShareInput = z
  .object({ idempotency_key: z.string().min(8).max(128) })
  .strict();
export const shareOutput = z.object({
  share_id: z.uuid(),
  sharer: z.object({ id: z.string(), name: z.string() }),
  normalized_url: z.string(),
  processing_status: z.enum([
    "queued",
    "processing",
    "ready",
    "failed",
    "deferred_quota",
  ]),
  content_scope_note: z.string(),
  article_summary: articleSummary.nullable(),
  video_summary: articleSummary.nullable(),
  video_description: z.string().nullable(),
  video_id: z.string().nullable(),
  author: z.string().nullable(),
  thumbnail_url: z.string().nullable(),
  embeddable: z.boolean().nullable(),
  excerpt: z.string().nullable(),
  truncated: z.boolean(),
  failure_code: z.string().nullable(),
  can_retry: z.boolean(),
  withdrawn: z.boolean(),
  id: z.uuid(),
  content_id: z.uuid(),
  original_url: z.string(),
  shared_at: z.iso.datetime(),
  shared_by: z.object({ id: z.string(), name: z.string() }),
  type: z.enum(["article", "youtube"]),
  title: z.string().nullable(),
  status: z.enum(["queued", "processing", "ready", "failed", "deferred_quota"]),
  source: z.enum([
    "none",
    "ai_article_summary",
    "ai_video_summary",
    "youtube_description",
  ]),
  full_content_available: z.literal(false),
});
export const listSharesOutput = z.object({
  items: z.array(shareOutput),
  next_cursor: z.string().nullable(),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
});
export const contracts = {
  share_link: {
    input: shareLinkInput,
    output: z.object({ share: shareOutput, replayed: z.boolean() }),
    scope: "shares:write",
  },
  list_shares: {
    input: listSharesInput,
    output: listSharesOutput,
    scope: "shares:read",
  },
  get_share: {
    input: getShareInput,
    output: shareOutput,
    scope: "shares:read",
  },
  list_members: {
    input: listMembersInput,
    output: z.object({
      next_cursor: z.string().nullable(),
      members: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          email: z.email(),
          active: z.boolean(),
        }),
      ),
    }),
    scope: "members:read",
  },
  withdraw_share: {
    input: withdrawShareInput,
    output: z.object({ share_id: z.uuid(), withdrawn: z.literal(true) }),
    scope: "shares:write",
  },
} as const;
