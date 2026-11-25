CREATE TABLE "ai_prompt_set_members" (
	"version_id" text NOT NULL,
	"prompt_id" text NOT NULL,
	CONSTRAINT "ai_prompt_set_members_version_id_prompt_id_pk" PRIMARY KEY("version_id","prompt_id")
);
--> statement-breakpoint
CREATE TABLE "ai_prompt_set_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"tracker_id" text NOT NULL,
	"version" integer NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"opportunity_id" text,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"publication_status" text DEFAULT 'not_started' NOT NULL,
	"target_url" text,
	"content_asset_id" text,
	"content_revision" integer,
	"external_id" text,
	"proposed_action" text NOT NULL,
	"before_state" text,
	"after_state" text,
	"diff" text,
	"requested_by_user_id" text NOT NULL,
	"approved_by_user_id" text,
	"approved_at" text,
	"approved_revision" integer,
	"executed_by_user_id" text,
	"executed_at" text,
	"error" text,
	"rollback_kind" text DEFAULT 'none' NOT NULL,
	"rollback_payload" text,
	"rolled_back_at" text,
	"rolled_back_by_user_id" text,
	"measurement_metric" text,
	"measurement_window_days" integer,
	"baseline_start" text,
	"baseline_end" text,
	"final_decision" text,
	"final_decided_by_user_id" text,
	"final_decided_at" text,
	"idempotency_key" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_ledger_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"entry_id" text NOT NULL,
	"source" text NOT NULL,
	"label" text NOT NULL,
	"value" text NOT NULL,
	"url" text,
	"observed_at" text
);
--> statement-breakpoint
CREATE TABLE "change_ledger_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"entry_id" text NOT NULL,
	"phase" text NOT NULL,
	"source" text NOT NULL,
	"metric" text NOT NULL,
	"value" real NOT NULL,
	"numerator" real,
	"denominator" real,
	"window_start" text,
	"window_end" text,
	"observed_at" text NOT NULL,
	"ai_run_id" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "opportunity_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"source" text NOT NULL,
	"label" text NOT NULL,
	"value" text NOT NULL,
	"url" text,
	"observed_at" text
);
--> statement-breakpoint
CREATE TABLE "project_spend_limits" (
	"project_id" text PRIMARY KEY NOT NULL,
	"daily_usd" real,
	"monthly_usd" real,
	"scheduled_jobs_per_day" integer,
	"updated_by_user_id" text NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_costs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"ledger_entry_id" text,
	"provider" text NOT NULL,
	"operation" text NOT NULL,
	"estimated_usd" real,
	"cost_usd" real NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_matches" ADD COLUMN "recommended" boolean;--> statement-breakpoint
ALTER TABLE "ai_observations" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "prompt_set_version_id" text;--> statement-breakpoint
ALTER TABLE "content_opportunities" ADD COLUMN "intent" text;--> statement-breakpoint
ALTER TABLE "content_opportunities" ADD COLUMN "priority" text;--> statement-breakpoint
ALTER TABLE "content_opportunities" ADD COLUMN "priority_reason" text;--> statement-breakpoint
ALTER TABLE "content_opportunities" ADD COLUMN "observed_at" text;--> statement-breakpoint
ALTER TABLE "ai_prompt_set_members" ADD CONSTRAINT "ai_prompt_set_members_version_id_ai_prompt_set_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."ai_prompt_set_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_prompt_set_members" ADD CONSTRAINT "ai_prompt_set_members_prompt_id_ai_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."ai_prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_prompt_set_versions" ADD CONSTRAINT "ai_prompt_set_versions_tracker_id_ai_trackers_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."ai_trackers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_ledger_entries" ADD CONSTRAINT "change_ledger_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_ledger_entries" ADD CONSTRAINT "change_ledger_entries_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_ledger_entries" ADD CONSTRAINT "change_ledger_entries_opportunity_id_content_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."content_opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_ledger_entries" ADD CONSTRAINT "change_ledger_entries_content_asset_id_content_assets_id_fk" FOREIGN KEY ("content_asset_id") REFERENCES "public"."content_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_ledger_evidence" ADD CONSTRAINT "change_ledger_evidence_entry_id_change_ledger_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."change_ledger_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_ledger_observations" ADD CONSTRAINT "change_ledger_observations_entry_id_change_ledger_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."change_ledger_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_evidence" ADD CONSTRAINT "opportunity_evidence_opportunity_id_content_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."content_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_spend_limits" ADD CONSTRAINT "project_spend_limits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_costs" ADD CONSTRAINT "provider_costs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_costs" ADD CONSTRAINT "provider_costs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_costs" ADD CONSTRAINT "provider_costs_ledger_entry_id_change_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."change_ledger_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_prompt_set_versions_tracker_version_idx" ON "ai_prompt_set_versions" USING btree ("tracker_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "change_ledger_entries_idempotency_idx" ON "change_ledger_entries" USING btree ("project_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "change_ledger_entries_project_idx" ON "change_ledger_entries" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "change_ledger_entries_opportunity_idx" ON "change_ledger_entries" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "change_ledger_evidence_entry_idx" ON "change_ledger_evidence" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "change_ledger_observations_entry_idx" ON "change_ledger_observations" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "opportunity_evidence_opportunity_idx" ON "opportunity_evidence" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "provider_costs_project_idx" ON "provider_costs" USING btree ("project_id","created_at");