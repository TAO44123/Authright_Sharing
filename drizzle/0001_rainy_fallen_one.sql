DROP INDEX "agent_grants_connection";--> statement-breakpoint
ALTER TABLE "agent_grants" ADD COLUMN "authorization_code_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_grants_legacy_connection" ON "agent_grants" USING btree ("user_id","client_id","session_id") WHERE "agent_grants"."authorization_code_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_grants_authorization" ON "agent_grants" USING btree ("authorization_code_id");--> statement-breakpoint
-- Already-revoked legacy connections must require consent on their next login.
DELETE FROM "oauth_consent" AS consent
WHERE EXISTS (
  SELECT 1 FROM "agent_grants" AS grant_record
  WHERE grant_record.user_id = consent.user_id
    AND grant_record.client_id = consent.client_id
    AND grant_record.revoked_at IS NOT NULL
);--> statement-breakpoint
-- Remove revoked refresh chains without touching web sessions or active grants.
DELETE FROM "oauth_refresh_token" AS refresh
WHERE EXISTS (
  SELECT 1 FROM "agent_grants" AS grant_record
  WHERE grant_record.user_id = refresh.user_id
    AND grant_record.client_id = refresh.client_id
    AND grant_record.session_id = refresh.session_id
    AND grant_record.revoked_at IS NOT NULL
);
