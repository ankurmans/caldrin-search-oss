CREATE TABLE "ai_claim_corrections" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"assessment_id" text,
	"claim_id" text,
	"opportunity_id" text NOT NULL,
	"asset_id" text,
	"outreach_draft" text,
	"ledger_id" text,
	"kind" text NOT NULL,
	"target_url" text NOT NULL,
	"baseline_run_id" text,
	"baseline_observation_id" text,
	"fact_version_id" text NOT NULL,
	"before_snapshot_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_claim_followups" (
	"id" text PRIMARY KEY NOT NULL,
	"correction_id" text NOT NULL,
	"ledger_id" text NOT NULL,
	"observation_id" text NOT NULL,
	"outcome" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_claim_group_history" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"claim_id" text NOT NULL,
	"previous_target" text,
	"target" text,
	"actor_id" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_claim_jobs" ADD COLUMN "credits_per_answer" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_claim_jobs" ADD COLUMN "billing_error" text;--> statement-breakpoint
ALTER TABLE "ai_claim_corrections" ADD CONSTRAINT "ai_claim_corrections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_claim_corrections" ADD CONSTRAINT "ai_claim_corrections_assessment_id_ai_claim_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."ai_claim_assessments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_claim_corrections" ADD CONSTRAINT "ai_claim_corrections_claim_id_ai_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."ai_claims"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_claim_corrections" ADD CONSTRAINT "ai_claim_corrections_opportunity_id_content_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."content_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_claim_corrections" ADD CONSTRAINT "ai_claim_corrections_asset_id_content_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."content_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_claim_corrections" ADD CONSTRAINT "ai_claim_corrections_ledger_id_change_ledger_entries_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."change_ledger_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_claim_corrections" ADD CONSTRAINT "ai_claim_corrections_baseline_run_id_ai_runs_id_fk" FOREIGN KEY ("baseline_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_claim_corrections" ADD CONSTRAINT "ai_claim_corrections_baseline_observation_id_ai_observations_id_fk" FOREIGN KEY ("baseline_observation_id") REFERENCES "public"."ai_observations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_claim_corrections" ADD CONSTRAINT "ai_claim_corrections_fact_version_id_ai_claim_fact_versions_id_fk" FOREIGN KEY ("fact_version_id") REFERENCES "public"."ai_claim_fact_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_claim_corrections" ADD CONSTRAINT "ai_claim_corrections_before_snapshot_id_ai_claim_source_snapshots_id_fk" FOREIGN KEY ("before_snapshot_id") REFERENCES "public"."ai_claim_source_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_claim_followups" ADD CONSTRAINT "ai_claim_followups_correction_id_ai_claim_corrections_id_fk" FOREIGN KEY ("correction_id") REFERENCES "public"."ai_claim_corrections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_claim_followups" ADD CONSTRAINT "ai_claim_followups_ledger_id_change_ledger_entries_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."change_ledger_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_claim_followups" ADD CONSTRAINT "ai_claim_followups_observation_id_ai_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."ai_observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_claim_group_history" ADD CONSTRAINT "ai_claim_group_history_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_claim_group_history" ADD CONSTRAINT "ai_claim_group_history_claim_id_ai_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."ai_claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_claim_corrections_project" ON "ai_claim_corrections" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_claim_followups_observation" ON "ai_claim_followups" USING btree ("correction_id","observation_id");--> statement-breakpoint
CREATE INDEX "ai_claim_group_history_claim" ON "ai_claim_group_history" USING btree ("claim_id","created_at");