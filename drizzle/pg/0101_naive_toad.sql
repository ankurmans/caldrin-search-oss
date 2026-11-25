CREATE TABLE "content_refresh_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"opportunity_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_refresh_jobs" ADD CONSTRAINT "content_refresh_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_refresh_jobs" ADD CONSTRAINT "content_refresh_jobs_opportunity_id_content_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."content_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_refresh_jobs_project_opportunity" ON "content_refresh_jobs" USING btree ("project_id","opportunity_id");--> statement-breakpoint
CREATE INDEX "content_refresh_jobs_batch" ON "content_refresh_jobs" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "content_refresh_jobs_status_time" ON "content_refresh_jobs" USING btree ("status","updated_at");