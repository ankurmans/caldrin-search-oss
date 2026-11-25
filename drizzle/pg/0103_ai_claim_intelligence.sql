CREATE TABLE "ai_claim_assessment_facts" (
	"id" text PRIMARY KEY NOT NULL,
	"assessment_id" text NOT NULL,
	"fact_version_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_claim_assessments" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"occurrence_id" text NOT NULL,
	"status" text NOT NULL,
	"recipe" text NOT NULL,
	"input_hash" text NOT NULL,
	"rationale" text NOT NULL,
	"created_at" text NOT NULL,
	"reviewer_id" text,
	"reviewed_at" text,
	"review" text
);
--> statement-breakpoint
CREATE TABLE "ai_claim_extractions" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"observation_id" text NOT NULL,
	"input_hash" text NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" real
);
--> statement-breakpoint
CREATE TABLE "ai_claim_fact_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"fact_key" text NOT NULL,
	"previous_id" text,
	"legacy_fact_id" text,
	"subject" text NOT NULL,
	"predicate" text NOT NULL,
	"fact_value" text NOT NULL,
	"polarity" text NOT NULL,
	"plan" text,
	"product" text,
	"market" text,
	"product_version" text,
	"condition" text,
	"effective_from" text NOT NULL,
	"effective_until" text,
	"source_url" text,
	"evidence" text NOT NULL,
	"owner_id" text NOT NULL,
	"reviewer_id" text,
	"reviewed_at" text,
	"created_at" text NOT NULL,
	"state" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_claim_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"run_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"model" text NOT NULL,
	"provider" text NOT NULL,
	"recipe" text NOT NULL,
	"status" text NOT NULL,
	"created_at" text NOT NULL,
	"expires_at" text NOT NULL,
	"lease_until" text
);
--> statement-breakpoint
CREATE TABLE "ai_claim_occurrences" (
	"id" text PRIMARY KEY NOT NULL,
	"claim_id" text NOT NULL,
	"extraction_id" text NOT NULL,
	"span_start" integer NOT NULL,
	"span_end" integer NOT NULL,
	"confidence" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_claim_source_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"url" text NOT NULL,
	"final_url" text,
	"canonical_url" text,
	"title" text,
	"excerpt" text,
	"content_hash" text,
	"http_status" integer,
	"reason" text,
	"fetched_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"claim_key" text NOT NULL,
	"subject" text NOT NULL,
	"predicate" text NOT NULL,
	"claim_value" text NOT NULL,
	"category" text NOT NULL,
	"polarity" text NOT NULL,
	"plan" text,
	"market" text,
	"product" text,
	"product_version" text,
	"effective_date" text,
	"condition" text,
	"merged_into" text
);
--> statement-breakpoint
ALTER TABLE "ai_claim_assessment_facts" ADD CONSTRAINT "ai_claim_assessment_facts_assessment_id_ai_claim_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."ai_claim_assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_claim_assessment_facts" ADD CONSTRAINT "ai_claim_assessment_facts_fact_version_id_ai_claim_fact_versions_id_fk" FOREIGN KEY ("fact_version_id") REFERENCES "public"."ai_claim_fact_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_claim_assessments" ADD CONSTRAINT "ai_claim_assessments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_claim_assessments" ADD CONSTRAINT "ai_claim_assessments_occurrence_id_ai_claim_occurrences_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."ai_claim_occurrences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_claim_extractions" ADD CONSTRAINT "ai_claim_extractions_job_id_ai_claim_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ai_claim_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_claim_extractions" ADD CONSTRAINT "ai_claim_extractions_observation_id_ai_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."ai_observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_claim_fact_versions" ADD CONSTRAINT "ai_claim_fact_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_claim_fact_versions" ADD CONSTRAINT "ai_claim_fact_versions_legacy_fact_id_ai_brand_facts_id_fk" FOREIGN KEY ("legacy_fact_id") REFERENCES "public"."ai_brand_facts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_claim_jobs" ADD CONSTRAINT "ai_claim_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_claim_jobs" ADD CONSTRAINT "ai_claim_jobs_run_id_ai_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_claim_occurrences" ADD CONSTRAINT "ai_claim_occurrences_claim_id_ai_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."ai_claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_claim_occurrences" ADD CONSTRAINT "ai_claim_occurrences_extraction_id_ai_claim_extractions_id_fk" FOREIGN KEY ("extraction_id") REFERENCES "public"."ai_claim_extractions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_claim_source_snapshots" ADD CONSTRAINT "ai_claim_source_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_claims" ADD CONSTRAINT "ai_claims_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_claim_assessment_fact" ON "ai_claim_assessment_facts" USING btree ("assessment_id","fact_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_claim_assessments_input" ON "ai_claim_assessments" USING btree ("occurrence_id","recipe","input_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_claim_extractions_job_observation" ON "ai_claim_extractions" USING btree ("job_id","observation_id");--> statement-breakpoint
CREATE INDEX "ai_claim_fact_versions_project" ON "ai_claim_fact_versions" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_claim_fact_active_approval" ON "ai_claim_fact_versions" USING btree ("project_id","fact_key") WHERE "ai_claim_fact_versions"."state" = 'approved';--> statement-breakpoint
CREATE UNIQUE INDEX "ai_claim_fact_active_draft" ON "ai_claim_fact_versions" USING btree ("project_id","fact_key") WHERE "ai_claim_fact_versions"."state" = 'draft';--> statement-breakpoint
CREATE INDEX "ai_claim_jobs_queue_idx" ON "ai_claim_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_claim_jobs_active_project" ON "ai_claim_jobs" USING btree ("project_id") WHERE "ai_claim_jobs"."status" IN ('queued', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "ai_claim_jobs_running_workspace" ON "ai_claim_jobs" USING btree ("workspace_id") WHERE "ai_claim_jobs"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "ai_claim_occurrence_span" ON "ai_claim_occurrences" USING btree ("extraction_id","claim_id","span_start","span_end");--> statement-breakpoint
CREATE INDEX "ai_claim_occurrences_claim" ON "ai_claim_occurrences" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "ai_claim_snapshots_cache" ON "ai_claim_source_snapshots" USING btree ("project_id","url","fetched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_claims_project_key" ON "ai_claims" USING btree ("project_id","claim_key");