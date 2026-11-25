CREATE TABLE "monitoring_job_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"job" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"attempt" integer NOT NULL,
	"started_at" text NOT NULL,
	"finished_at" text,
	"idempotency_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"details_json" text NOT NULL,
	"comparable" boolean NOT NULL,
	"dedupe_key" text NOT NULL,
	"created_at" text NOT NULL,
	"read_at" text,
	"emailed_at" text
);
--> statement-breakpoint
ALTER TABLE "ai_matches" ADD COLUMN "extraction_version" text;--> statement-breakpoint
ALTER TABLE "ai_prompts" ADD COLUMN "intent" text;--> statement-breakpoint
ALTER TABLE "monitoring_job_runs" ADD CONSTRAINT "monitoring_job_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_alerts" ADD CONSTRAINT "project_alerts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_alerts" ADD CONSTRAINT "project_alerts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "monitoring_job_runs_idempotency_idx" ON "monitoring_job_runs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "monitoring_job_runs_project_idx" ON "monitoring_job_runs" USING btree ("project_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_alerts_project_dedupe_idx" ON "project_alerts" USING btree ("project_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "project_alerts_project_created_idx" ON "project_alerts" USING btree ("project_id","created_at");