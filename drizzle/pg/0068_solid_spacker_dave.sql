CREATE TABLE "link_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"referring_domain" text NOT NULL,
	"competitor_domain" text,
	"url_from" text NOT NULL,
	"url_to" text NOT NULL,
	"anchor" text,
	"text_before" text,
	"text_after" text,
	"semantic_location" text,
	"item_type" text,
	"is_dofollow" boolean,
	"is_nofollow" boolean NOT NULL,
	"is_sponsored" boolean NOT NULL,
	"is_ugc" boolean NOT NULL,
	"page_title" text,
	"page_language" text,
	"platform_type" text,
	"domain_rank" integer,
	"page_rank" integer,
	"spam_score" integer,
	"first_seen" text,
	"last_seen" text,
	"lost_date" text,
	"target_status_code" integer,
	"target_redirect" text,
	"source" text NOT NULL,
	"collected_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "link_gap_candidate_competitors" (
	"candidate_id" text NOT NULL,
	"competitor_domain" text NOT NULL,
	"backlinks" integer,
	"referring_pages" integer,
	"nofollow_pages" integer,
	"domain_rank" integer,
	"spam_score" integer,
	"first_seen" text,
	"lost_date" text,
	"top_platform" text,
	"top_placement" text,
	CONSTRAINT "link_gap_candidate_competitors_candidate_id_competitor_domain_pk" PRIMARY KEY("candidate_id","competitor_domain")
);
--> statement-breakpoint
CREATE TABLE "link_gap_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"project_id" text NOT NULL,
	"referring_domain" text NOT NULL,
	"competitor_count" integer NOT NULL,
	"domain_rank" integer,
	"spam_score" integer,
	"first_seen" text,
	"lost_date" text,
	"observed_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "link_gap_run_competitors" (
	"run_id" text NOT NULL,
	"competitor_domain" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "link_gap_run_competitors_run_id_competitor_domain_pk" PRIMARY KEY("run_id","competitor_domain")
);
--> statement-breakpoint
CREATE TABLE "link_gap_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"target_domain" text NOT NULL,
	"mode" text NOT NULL,
	"include_single" boolean NOT NULL,
	"link_status" text NOT NULL,
	"include_subdomains" boolean NOT NULL,
	"row_limit" integer NOT NULL,
	"provider_total" integer,
	"estimated_usd" real NOT NULL,
	"cost_usd" real NOT NULL,
	"status" text NOT NULL,
	"row_count" integer NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "link_outreach_draft_evidence" (
	"draft_id" text NOT NULL,
	"evidence_id" text NOT NULL,
	CONSTRAINT "link_outreach_draft_evidence_draft_id_evidence_id_pk" PRIMARY KEY("draft_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE "link_outreach_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"prospect_id" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"edited_by_user" boolean DEFAULT false NOT NULL,
	"approved_by" text,
	"approved_at" text,
	"created_by" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "link_outreach_events" (
	"id" text PRIMARY KEY NOT NULL,
	"draft_id" text NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"actor" text NOT NULL,
	"actor_user_id" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "link_outreach_suppressions" (
	"project_id" text NOT NULL,
	"value" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "link_outreach_suppressions_project_id_value_pk" PRIMARY KEY("project_id","value")
);
--> statement-breakpoint
CREATE TABLE "link_placement_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"placement_id" text NOT NULL,
	"outcome" text NOT NULL,
	"http_status" integer,
	"final_url" text,
	"canonical_url" text,
	"found_href" text,
	"anchor" text,
	"is_nofollow" boolean,
	"is_sponsored" boolean,
	"is_ugc" boolean,
	"context" text,
	"note" text,
	"checked_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "link_placements" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"prospect_id" text,
	"campaign_mode" text NOT NULL,
	"url_from" text NOT NULL,
	"expected_target" text NOT NULL,
	"state" text DEFAULT 'promised' NOT NULL,
	"cost_usd" real,
	"first_verified_at" text,
	"last_verified_at" text,
	"last_checked_at" text,
	"created_by" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "link_prospect_events" (
	"id" text PRIMARY KEY NOT NULL,
	"prospect_id" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"note" text,
	"actor" text NOT NULL,
	"actor_user_id" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "link_prospect_signals" (
	"id" text PRIMARY KEY NOT NULL,
	"prospect_id" text NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"url" text,
	"source" text NOT NULL,
	"observed_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "link_prospects" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"referring_domain" text NOT NULL,
	"page_url" text,
	"method" text NOT NULL,
	"campaign_mode" text DEFAULT 'earned_editorial' NOT NULL,
	"status" text DEFAULT 'discovered' NOT NULL,
	"recommendation" text,
	"score" integer,
	"target_url" text,
	"content_opportunity_id" text,
	"source_run_id" text,
	"assignee_user_id" text,
	"due_date" text,
	"notes" text,
	"created_by" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "link_qualification_settings" (
	"project_id" text PRIMARY KEY NOT NULL,
	"min_competitors" integer DEFAULT 1 NOT NULL,
	"preferred_language" text,
	"soft_max_spam_score" integer DEFAULT 40 NOT NULL,
	"soft_min_domain_rank" integer DEFAULT 100 NOT NULL,
	"weight_competitors" integer DEFAULT 30 NOT NULL,
	"weight_authority" integer DEFAULT 15 NOT NULL,
	"weight_context" integer DEFAULT 20 NOT NULL,
	"weight_follow" integer DEFAULT 10 NOT NULL,
	"weight_persistence" integer DEFAULT 10 NOT NULL,
	"weight_effort" integer DEFAULT 15 NOT NULL,
	"pursue_at" integer DEFAULT 60 NOT NULL,
	"skip_below" integer DEFAULT 35 NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "link_evidence" ADD CONSTRAINT "link_evidence_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_gap_candidate_competitors" ADD CONSTRAINT "link_gap_candidate_competitors_candidate_id_link_gap_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."link_gap_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_gap_candidates" ADD CONSTRAINT "link_gap_candidates_run_id_link_gap_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."link_gap_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_gap_candidates" ADD CONSTRAINT "link_gap_candidates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_gap_run_competitors" ADD CONSTRAINT "link_gap_run_competitors_run_id_link_gap_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."link_gap_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_gap_runs" ADD CONSTRAINT "link_gap_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_outreach_draft_evidence" ADD CONSTRAINT "link_outreach_draft_evidence_draft_id_link_outreach_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."link_outreach_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_outreach_draft_evidence" ADD CONSTRAINT "link_outreach_draft_evidence_evidence_id_link_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."link_evidence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_outreach_drafts" ADD CONSTRAINT "link_outreach_drafts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_outreach_drafts" ADD CONSTRAINT "link_outreach_drafts_prospect_id_link_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."link_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_outreach_events" ADD CONSTRAINT "link_outreach_events_draft_id_link_outreach_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."link_outreach_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_outreach_suppressions" ADD CONSTRAINT "link_outreach_suppressions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_placement_checks" ADD CONSTRAINT "link_placement_checks_placement_id_link_placements_id_fk" FOREIGN KEY ("placement_id") REFERENCES "public"."link_placements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_placements" ADD CONSTRAINT "link_placements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_placements" ADD CONSTRAINT "link_placements_prospect_id_link_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."link_prospects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_prospect_events" ADD CONSTRAINT "link_prospect_events_prospect_id_link_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."link_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_prospect_signals" ADD CONSTRAINT "link_prospect_signals_prospect_id_link_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."link_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_prospects" ADD CONSTRAINT "link_prospects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_prospects" ADD CONSTRAINT "link_prospects_source_run_id_link_gap_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."link_gap_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_qualification_settings" ADD CONSTRAINT "link_qualification_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "link_evidence_link_idx" ON "link_evidence" USING btree ("project_id","url_from","url_to");--> statement-breakpoint
CREATE INDEX "link_evidence_project_domain_idx" ON "link_evidence" USING btree ("project_id","referring_domain");--> statement-breakpoint
CREATE UNIQUE INDEX "link_gap_candidates_run_domain_idx" ON "link_gap_candidates" USING btree ("run_id","referring_domain");--> statement-breakpoint
CREATE INDEX "link_gap_candidates_project_run_idx" ON "link_gap_candidates" USING btree ("project_id","run_id");--> statement-breakpoint
CREATE INDEX "link_gap_runs_project_created_idx" ON "link_gap_runs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "link_outreach_drafts_prospect_idx" ON "link_outreach_drafts" USING btree ("prospect_id","created_at");--> statement-breakpoint
CREATE INDEX "link_outreach_events_draft_idx" ON "link_outreach_events" USING btree ("draft_id","created_at");--> statement-breakpoint
CREATE INDEX "link_placement_checks_placement_idx" ON "link_placement_checks" USING btree ("placement_id","checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "link_placements_project_link_idx" ON "link_placements" USING btree ("project_id","url_from","expected_target");--> statement-breakpoint
CREATE INDEX "link_prospect_events_prospect_idx" ON "link_prospect_events" USING btree ("prospect_id","created_at");--> statement-breakpoint
CREATE INDEX "link_prospect_signals_prospect_idx" ON "link_prospect_signals" USING btree ("prospect_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "link_prospects_project_key_idx" ON "link_prospects" USING btree ("project_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "link_prospects_project_status_idx" ON "link_prospects" USING btree ("project_id","status");