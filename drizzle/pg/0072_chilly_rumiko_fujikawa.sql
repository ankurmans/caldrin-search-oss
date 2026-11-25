CREATE TABLE "ai_tracker_markets" (
	"tracker_id" text NOT NULL,
	"location_code" integer NOT NULL,
	"language_code" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "ai_tracker_markets_tracker_id_location_code_language_code_pk" PRIMARY KEY("tracker_id","location_code","language_code")
);
--> statement-breakpoint
DROP INDEX "ai_runs_one_active_idx";--> statement-breakpoint
ALTER TABLE "ai_tracker_markets" ADD CONSTRAINT "ai_tracker_markets_tracker_id_ai_trackers_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."ai_trackers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_runs_one_active_idx" ON "ai_runs" USING btree ("tracker_id","location_code","language_code") WHERE "ai_runs"."status" IN ('queued', 'running');