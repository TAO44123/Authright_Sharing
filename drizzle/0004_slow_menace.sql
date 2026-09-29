ALTER TABLE "usage_events" ADD COLUMN "usage_details" jsonb;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "cached_input_price_per_million" numeric(20, 10);