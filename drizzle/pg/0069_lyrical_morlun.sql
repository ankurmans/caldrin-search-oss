CREATE TABLE "provider_health_events" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"provider" text NOT NULL,
	"operation" text NOT NULL,
	"source" text NOT NULL,
	"ok" boolean NOT NULL,
	"kind" text,
	"http_status" integer,
	"message" text,
	"organization_id" text,
	"project_id" text
);
--> statement-breakpoint
CREATE INDEX "provider_health_events_created_idx" ON "provider_health_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "provider_health_events_operation_idx" ON "provider_health_events" USING btree ("operation","created_at");