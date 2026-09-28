import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  uniqueIndex,
  index,
  check,
  jsonb,
  boolean,
  numeric,
  date,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema.ts";
const time = (name: string) =>
  timestamp(name, { withTimezone: true, precision: 3 });
export const members = pgTable(
  "members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Legacy column name; initial identity/bootstrap email, not an allowlist.
    allowedEmail: text("allowed_email").notNull().unique(),
    userId: text("user_id")
      .unique()
      .references(() => user.id),
    role: text("role", { enum: ["admin", "member"] })
      .notNull()
      .default("member"),
    // Retained for migration compatibility. Access uses verified company email.
    status: text("status", { enum: ["active", "disabled"] })
      .notNull()
      .default("active"),
    timezone: text("timezone").notNull().default("America/New_York"),
    createdAt: time("created_at").notNull().defaultNow(),
    updatedAt: time("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("members_role_valid", sql`${t.role} in ('admin', 'member')`),
    check("members_status_valid", sql`${t.status} in ('active', 'disabled')`),
    check(
      "members_email_normalized",
      sql`${t.allowedEmail} = lower(btrim(${t.allowedEmail})) and position('@' in ${t.allowedEmail}) > 1`,
    ),
  ],
);
export const contents = pgTable(
  "contents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    normalizedUrl: text("normalized_url").notNull(),
    originalUrl: text("original_url").notNull(),
    type: text("type", { enum: ["article", "youtube"] }).notNull(),
    status: text("status", {
      enum: ["queued", "processing", "ready", "failed", "deferred_quota"],
    })
      .notNull()
      .default("queued"),
    title: text("title"),
    videoId: text("video_id"),
    author: text("author"),
    thumbnailUrl: text("thumbnail_url"),
    summaryOverview: text("summary_overview"),
    summaryKeyPoints: jsonb("summary_key_points").$type<string[]>(),
    videoDescription: text("video_description"),
    durationSeconds: integer("duration_seconds"),
    embeddable: boolean("embeddable"),
    failureCode: text("failure_code"),
    summaryModel: text("summary_model"),
    promptVersion: text("prompt_version"),
    generatedAt: time("generated_at"),
    metadataFetchedAt: time("metadata_fetched_at"),
    metadataExpiresAt: time("metadata_expires_at"),
    updatedAt: time("updated_at").notNull().defaultNow(),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("contents_type_valid", sql`${t.type} in ('article', 'youtube')`),
    check(
      "contents_status_valid",
      sql`${t.status} in ('queued', 'processing', 'ready', 'failed', 'deferred_quota')`,
    ),
    check(
      "contents_video_id_valid",
      sql`${t.videoId} is null or (${t.type} = 'youtube' and ${t.videoId} ~ '^[A-Za-z0-9_-]{11}$')`,
    ),
    check(
      "contents_duration_valid",
      sql`${t.durationSeconds} is null or ${t.durationSeconds} >= 0`,
    ),
    check(
      "contents_summary_shape",
      sql`${t.summaryKeyPoints} is null or (jsonb_typeof(${t.summaryKeyPoints}) = 'array' and jsonb_array_length(${t.summaryKeyPoints}) between 3 and 5)`,
    ),
    check(
      "contents_source_fields",
      sql`(${t.type} = 'article' and ${t.videoDescription} is null) or (${t.type} = 'youtube' and ${t.summaryOverview} is null and ${t.summaryKeyPoints} is null and ${t.summaryModel} is null)`,
    ),
    check(
      "contents_metadata_window",
      sql`${t.metadataExpiresAt} is null or (${t.metadataFetchedAt} is not null and ${t.metadataExpiresAt} > ${t.metadataFetchedAt})`,
    ),
    index("contents_metadata_expiry_idx")
      .on(t.metadataExpiresAt)
      .where(sql`${t.type} = 'youtube'`),
  ],
);
export const shares = pgTable(
  "shares",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contentId: uuid("content_id")
      .notNull()
      .references(() => contents.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    originalUrl: text("original_url").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
    withdrawnAt: time("withdrawn_at"),
  },
  (t) => [
    index("shares_order_idx").on(t.createdAt, t.id),
    index("shares_user_idx").on(t.userId),
    index("shares_active_order_idx")
      .on(t.createdAt.desc(), t.id.desc())
      .where(sql`${t.withdrawnAt} is null`),
    index("shares_active_user_order_idx")
      .on(t.userId, t.createdAt.desc(), t.id.desc())
      .where(sql`${t.withdrawnAt} is null`),
    index("shares_content_idx").on(t.contentId),
  ],
);
export const idempotency = pgTable(
  "idempotency_keys",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    operation: text("operation").notNull(),
    key: text("key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    shareId: uuid("share_id")
      .notNull()
      .references(() => shares.id),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("idempotency_actor_operation_key").on(
      t.userId,
      t.operation,
      t.key,
    ),
  ],
);
export const tasks = pgTable(
  "content_tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contentId: uuid("content_id")
      .notNull()
      .references(() => contents.id),
    kind: text("kind").notNull().default("process_content"),
    state: text("state", {
      enum: [
        "queued",
        "processing",
        "retry_wait",
        "deferred_quota",
        "completed",
        "failed",
        "cancelled",
      ],
    })
      .notNull()
      .default("queued"),
    generation: integer("generation").notNull().default(1),
    attempts: integer("attempts").notNull().default(0),
    jobId: uuid("job_id").notNull(),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: time("lease_expires_at"),
    startedAt: time("started_at"),
    finishedAt: time("finished_at"),
    retryAfter: time("retry_after"),
    failureCode: text("failure_code"),
    updatedAt: time("updated_at").notNull().defaultNow(),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("content_tasks_one_active")
      .on(t.contentId, t.kind)
      .where(
        sql`${t.state} in ('queued', 'processing', 'retry_wait', 'deferred_quota')`,
      ),
    check(
      "content_tasks_kind_valid",
      sql`${t.kind} in ('process_content', 'article_summary', 'youtube_preview', 'youtube_refresh')`,
    ),
    check(
      "content_tasks_state_valid",
      sql`${t.state} in ('queued', 'processing', 'retry_wait', 'deferred_quota', 'completed', 'failed', 'cancelled')`,
    ),
    check(
      "content_tasks_counters_valid",
      sql`${t.generation} > 0 and ${t.attempts} >= 0`,
    ),
    check(
      "content_tasks_lease_pair",
      sql`(${t.leaseToken} is null) = (${t.leaseExpiresAt} is null)`,
    ),
    index("content_tasks_recovery_idx").on(t.state, t.leaseExpiresAt),
  ],
);
export const agentGrants = pgTable(
  "agent_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    clientId: text("client_id").notNull(),
    sessionId: text("session_id").notNull(),
    scopes: text("scopes")
      .array()
      .notNull()
      .default(sql`ARRAY['shares:read']::text[]`),
    // Null only for connections issued before per-authorization binding.
    authorizationCodeId: text("authorization_code_id"),
    createdAt: time("created_at").notNull().defaultNow(),
    revokedAt: time("revoked_at"),
  },
  (t) => [
    uniqueIndex("agent_grants_legacy_connection")
      .on(t.userId, t.clientId, t.sessionId)
      .where(sql`${t.authorizationCodeId} is null`),
    uniqueIndex("agent_grants_authorization").on(t.authorizationCodeId),
  ],
);

// Existing S1 table names are retained. These records contain metadata only;
// source bodies, provider responses and credentials never belong in task payloads.
export const attempts = pgTable(
  "processing_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),
    generation: integer("generation").notNull(),
    attemptNo: integer("attempt_no").notNull(),
    stage: text("stage", {
      enum: ["fetch", "extract", "summarize", "youtube", "persist"],
    }).notNull(),
    outcome: text("outcome", {
      enum: ["started", "succeeded", "failed", "outcome_unknown", "cancelled"],
    })
      .notNull()
      .default("started"),
    requestId: uuid("request_id").notNull().defaultRandom(),
    failureCode: text("failure_code"),
    startedAt: time("started_at").notNull().defaultNow(),
    finishedAt: time("finished_at"),
  },
  (t) => [
    uniqueIndex("attempts_task_generation_number").on(
      t.taskId,
      t.generation,
      t.attemptNo,
    ),
    check(
      "attempts_counters_valid",
      sql`${t.generation} > 0 and ${t.attemptNo} > 0`,
    ),
    check(
      "attempts_stage_valid",
      sql`${t.stage} in ('fetch', 'extract', 'summarize', 'youtube', 'persist')`,
    ),
    check(
      "attempts_outcome_valid",
      sql`${t.outcome} in ('started', 'succeeded', 'failed', 'outcome_unknown', 'cancelled')`,
    ),
  ],
);
export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => attempts.id),
    service: text("service").notNull(),
    invocationIndex: integer("invocation_index").notNull().default(1),
    model: text("model"),
    providerRequestId: text("provider_request_id"),
    status: text("status", {
      enum: ["started", "succeeded", "failed", "outcome_unknown"],
    }).notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    usageKnown: boolean("usage_known").notNull().default(false),
    estimatedAmount: numeric("estimated_amount", { precision: 20, scale: 10 }),
    currency: text("currency"),
    priceVersion: text("price_version"),
    inputPricePerMillion: numeric("input_price_per_million", {
      precision: 20,
      scale: 10,
    }),
    outputPricePerMillion: numeric("output_price_per_million", {
      precision: 20,
      scale: 10,
    }),
    pricedAt: time("priced_at"),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("usage_attempt_service_invocation").on(
      t.attemptId,
      t.service,
      t.invocationIndex,
    ),
    index("usage_created_service_idx").on(t.createdAt, t.service),
    check(
      "usage_status_valid",
      sql`${t.status} in ('started', 'succeeded', 'failed', 'outcome_unknown')`,
    ),
    check(
      "usage_nonnegative",
      sql`${t.invocationIndex} > 0 and (${t.inputTokens} is null or ${t.inputTokens} >= 0) and (${t.outputTokens} is null or ${t.outputTokens} >= 0) and (${t.estimatedAmount} is null or ${t.estimatedAmount} >= 0) and (${t.inputPricePerMillion} is null or ${t.inputPricePerMillion} >= 0) and (${t.outputPricePerMillion} is null or ${t.outputPricePerMillion} >= 0)`,
    ),
    check(
      "usage_unknown_is_null",
      sql`${t.usageKnown} or (${t.inputTokens} is null and ${t.outputTokens} is null and ${t.estimatedAmount} is null)`,
    ),
    check(
      "usage_estimate_basis",
      sql`${t.estimatedAmount} is null or (${t.currency} is not null and ${t.priceVersion} is not null and ${t.pricedAt} is not null and ${t.inputPricePerMillion} is not null and ${t.outputPricePerMillion} is not null)`,
    ),
  ],
);
export const quotaReservations = pgTable(
  "quota_reservations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    attemptId: uuid("attempt_id")
      .notNull()
      .unique()
      .references(() => attempts.id),
    billingMonth: date("billing_month", { mode: "string" }).notNull(),
    units: integer("units").notNull().default(1),
    status: text("status", { enum: ["reserved", "consumed", "released"] })
      .notNull()
      .default("reserved"),
    createdAt: time("created_at").notNull().defaultNow(),
    updatedAt: time("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("quota_month_status_idx").on(t.billingMonth, t.status),
    check("quota_units_valid", sql`${t.units} = 1`),
    check("quota_month_valid", sql`extract(day from ${t.billingMonth}) = 1`),
    check(
      "quota_status_valid",
      sql`${t.status} in ('reserved', 'consumed', 'released')`,
    ),
  ],
);
export const settings = pgTable(
  "settings",
  {
    id: integer("id").primaryKey().default(1),
    quotaEnabled: boolean("quota_enabled").notNull().default(false),
    monthlyCallLimit: integer("monthly_call_limit"),
    defaultWindowDays: integer("default_window_days").notNull().default(7),
    pageSize: integer("page_size").notNull().default(20),
    version: integer("version").notNull().default(1),
    updatedAt: time("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("settings_singleton", sql`${t.id} = 1`),
    check(
      "settings_limits_valid",
      sql`(${t.monthlyCallLimit} is null or ${t.monthlyCallLimit} >= 0) and (not ${t.quotaEnabled} or ${t.monthlyCallLimit} is not null)`,
    ),
    check(
      "settings_defaults_valid",
      sql`${t.defaultWindowDays} > 0 and ${t.pageSize} between 1 and 100 and ${t.version} > 0`,
    ),
  ],
);
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorId: text("actor_id").references(() => user.id),
    action: text("action").notNull(),
    targetId: text("target_id").notNull(),
    // Narrowly typed changes avoid storing arbitrary request/profile data.
    changes: jsonb("changes")
      .$type<{
        role?: { before: string; after: string };
        status?: { before: string; after: string };
        quotaEnabled?: { before: boolean; after: boolean };
        monthlyCallLimit?: { before: number | null; after: number | null };
      }>()
      .notNull()
      .default({}),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_target_time_idx").on(t.targetId, t.createdAt)],
);
