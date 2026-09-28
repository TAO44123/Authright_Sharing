ALTER TABLE "contents" DROP CONSTRAINT "contents_source_fields";--> statement-breakpoint
ALTER TABLE "quota_reservations" DROP CONSTRAINT "quota_units_valid";--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_source_fields" CHECK ("contents"."type" = 'youtube' or "contents"."video_description" is null);--> statement-breakpoint
ALTER TABLE "quota_reservations" ADD CONSTRAINT "quota_units_valid" CHECK ("quota_reservations"."units" between 1 and 2);