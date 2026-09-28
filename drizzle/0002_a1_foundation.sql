CREATE TABLE "processing_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"attempt_no" integer NOT NULL,
	"stage" text NOT NULL,
	"outcome" text DEFAULT 'started' NOT NULL,
	"request_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"failure_code" text,
	"started_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp (3) with time zone,
	CONSTRAINT "attempts_counters_valid" CHECK ("processing_attempts"."generation" > 0 and "processing_attempts"."attempt_no" > 0),
	CONSTRAINT "attempts_stage_valid" CHECK ("processing_attempts"."stage" in ('fetch', 'extract', 'summarize', 'youtube', 'persist')),
	CONSTRAINT "attempts_outcome_valid" CHECK ("processing_attempts"."outcome" in ('started', 'succeeded', 'failed', 'outcome_unknown', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target_id" text NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quota_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"billing_month" date NOT NULL,
	"units" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quota_reservations_attempt_id_unique" UNIQUE("attempt_id"),
	CONSTRAINT "quota_units_valid" CHECK ("quota_reservations"."units" = 1),
	CONSTRAINT "quota_month_valid" CHECK (extract(day from "quota_reservations"."billing_month") = 1),
	CONSTRAINT "quota_status_valid" CHECK ("quota_reservations"."status" in ('reserved', 'consumed', 'released'))
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"quota_enabled" boolean DEFAULT false NOT NULL,
	"monthly_call_limit" integer,
	"default_window_days" integer DEFAULT 7 NOT NULL,
	"page_size" integer DEFAULT 20 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_singleton" CHECK ("settings"."id" = 1),
	CONSTRAINT "settings_limits_valid" CHECK (("settings"."monthly_call_limit" is null or "settings"."monthly_call_limit" >= 0) and (not "settings"."quota_enabled" or "settings"."monthly_call_limit" is not null)),
	CONSTRAINT "settings_defaults_valid" CHECK ("settings"."default_window_days" > 0 and "settings"."page_size" between 1 and 100 and "settings"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"service" text NOT NULL,
	"invocation_index" integer DEFAULT 1 NOT NULL,
	"model" text,
	"provider_request_id" text,
	"status" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"usage_known" boolean DEFAULT false NOT NULL,
	"estimated_amount" numeric(20, 10),
	"currency" text,
	"price_version" text,
	"input_price_per_million" numeric(20, 10),
	"output_price_per_million" numeric(20, 10),
	"priced_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_status_valid" CHECK ("usage_events"."status" in ('started', 'succeeded', 'failed', 'outcome_unknown')),
	CONSTRAINT "usage_nonnegative" CHECK ("usage_events"."invocation_index" > 0 and ("usage_events"."input_tokens" is null or "usage_events"."input_tokens" >= 0) and ("usage_events"."output_tokens" is null or "usage_events"."output_tokens" >= 0) and ("usage_events"."estimated_amount" is null or "usage_events"."estimated_amount" >= 0) and ("usage_events"."input_price_per_million" is null or "usage_events"."input_price_per_million" >= 0) and ("usage_events"."output_price_per_million" is null or "usage_events"."output_price_per_million" >= 0)),
	CONSTRAINT "usage_unknown_is_null" CHECK ("usage_events"."usage_known" or ("usage_events"."input_tokens" is null and "usage_events"."output_tokens" is null and "usage_events"."estimated_amount" is null)),
	CONSTRAINT "usage_estimate_basis" CHECK ("usage_events"."estimated_amount" is null or ("usage_events"."currency" is not null and "usage_events"."price_version" is not null and "usage_events"."priced_at" is not null and "usage_events"."input_price_per_million" is not null and "usage_events"."output_price_per_million" is not null))
);
--> statement-breakpoint
DROP INDEX "content_tasks_one_active";--> statement-breakpoint
ALTER TABLE "agent_grants" ADD COLUMN "scopes" text[] DEFAULT ARRAY['shares:read']::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "contents" ADD COLUMN "video_id" text;--> statement-breakpoint
ALTER TABLE "contents" ADD COLUMN "author" text;--> statement-breakpoint
ALTER TABLE "contents" ADD COLUMN "thumbnail_url" text;--> statement-breakpoint
ALTER TABLE "contents" ADD COLUMN "summary_overview" text;--> statement-breakpoint
ALTER TABLE "contents" ADD COLUMN "summary_key_points" jsonb;--> statement-breakpoint
ALTER TABLE "contents" ADD COLUMN "video_description" text;--> statement-breakpoint
ALTER TABLE "contents" ADD COLUMN "duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "contents" ADD COLUMN "embeddable" boolean;--> statement-breakpoint
ALTER TABLE "contents" ADD COLUMN "failure_code" text;--> statement-breakpoint
ALTER TABLE "contents" ADD COLUMN "summary_model" text;--> statement-breakpoint
ALTER TABLE "contents" ADD COLUMN "prompt_version" text;--> statement-breakpoint
ALTER TABLE "contents" ADD COLUMN "generated_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "contents" ADD COLUMN "metadata_fetched_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "contents" ADD COLUMN "metadata_expires_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "contents" ADD COLUMN "updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "content_tasks" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "content_tasks" ADD COLUMN "lease_expires_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "content_tasks" ADD COLUMN "started_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "content_tasks" ADD COLUMN "finished_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "content_tasks" ADD COLUMN "retry_after" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "content_tasks" ADD COLUMN "failure_code" text;--> statement-breakpoint
ALTER TABLE "content_tasks" ADD COLUMN "updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "processing_attempts" ADD CONSTRAINT "processing_attempts_task_id_content_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."content_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_reservations" ADD CONSTRAINT "quota_reservations_attempt_id_processing_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."processing_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_attempt_id_processing_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."processing_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attempts_task_generation_number" ON "processing_attempts" USING btree ("task_id","generation","attempt_no");--> statement-breakpoint
CREATE INDEX "audit_target_time_idx" ON "audit_events" USING btree ("target_id","created_at");--> statement-breakpoint
CREATE INDEX "quota_month_status_idx" ON "quota_reservations" USING btree ("billing_month","status");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_attempt_service_invocation" ON "usage_events" USING btree ("attempt_id","service","invocation_index");--> statement-breakpoint
CREATE INDEX "usage_created_service_idx" ON "usage_events" USING btree ("created_at","service");--> statement-breakpoint
CREATE INDEX "contents_metadata_expiry_idx" ON "contents" USING btree ("metadata_expires_at") WHERE "contents"."type" = 'youtube';--> statement-breakpoint
CREATE INDEX "shares_active_order_idx" ON "shares" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "shares"."withdrawn_at" is null;--> statement-breakpoint
CREATE INDEX "shares_active_user_order_idx" ON "shares" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "shares"."withdrawn_at" is null;--> statement-breakpoint
CREATE INDEX "shares_content_idx" ON "shares" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "content_tasks_recovery_idx" ON "content_tasks" USING btree ("state","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "content_tasks_one_active" ON "content_tasks" USING btree ("content_id","kind") WHERE "content_tasks"."state" in ('queued', 'processing', 'retry_wait', 'deferred_quota');--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_type_valid" CHECK ("contents"."type" in ('article', 'youtube'));--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_status_valid" CHECK ("contents"."status" in ('queued', 'processing', 'ready', 'failed', 'deferred_quota'));--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_video_id_valid" CHECK ("contents"."video_id" is null or ("contents"."type" = 'youtube' and "contents"."video_id" ~ '^[A-Za-z0-9_-]{11}$'));--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_duration_valid" CHECK ("contents"."duration_seconds" is null or "contents"."duration_seconds" >= 0);--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_summary_shape" CHECK ("contents"."summary_key_points" is null or (jsonb_typeof("contents"."summary_key_points") = 'array' and jsonb_array_length("contents"."summary_key_points") between 3 and 5));--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_source_fields" CHECK (("contents"."type" = 'article' and "contents"."video_description" is null) or ("contents"."type" = 'youtube' and "contents"."summary_overview" is null and "contents"."summary_key_points" is null and "contents"."summary_model" is null));--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_metadata_window" CHECK ("contents"."metadata_expires_at" is null or ("contents"."metadata_fetched_at" is not null and "contents"."metadata_expires_at" > "contents"."metadata_fetched_at"));--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_role_valid" CHECK ("members"."role" in ('admin', 'member'));--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_status_valid" CHECK ("members"."status" in ('active', 'disabled'));--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_email_normalized" CHECK ("members"."allowed_email" = lower(btrim("members"."allowed_email")) and position('@' in "members"."allowed_email") > 1);--> statement-breakpoint
ALTER TABLE "content_tasks" ADD CONSTRAINT "content_tasks_kind_valid" CHECK ("content_tasks"."kind" in ('process_content', 'article_summary', 'youtube_preview', 'youtube_refresh'));--> statement-breakpoint
ALTER TABLE "content_tasks" ADD CONSTRAINT "content_tasks_state_valid" CHECK ("content_tasks"."state" in ('queued', 'processing', 'retry_wait', 'deferred_quota', 'completed', 'failed', 'cancelled'));--> statement-breakpoint
ALTER TABLE "content_tasks" ADD CONSTRAINT "content_tasks_counters_valid" CHECK ("content_tasks"."generation" > 0 and "content_tasks"."attempts" >= 0);--> statement-breakpoint
ALTER TABLE "content_tasks" ADD CONSTRAINT "content_tasks_lease_pair" CHECK (("content_tasks"."lease_token" is null) = ("content_tasks"."lease_expires_at" is null));--> statement-breakpoint
-- Existing S1 YouTube keys are already normalized to the exact video ID.
UPDATE "contents" SET "video_id" = substring("dedupe_key" from 9)
WHERE "type" = 'youtube' AND "dedupe_key" ~ '^youtube:[A-Za-z0-9_-]{11}$';
--> statement-breakpoint
INSERT INTO "settings" ("id") VALUES (1) ON CONFLICT DO NOTHING;
