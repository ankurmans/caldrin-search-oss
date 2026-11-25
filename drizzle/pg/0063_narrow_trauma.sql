CREATE TABLE "keyword_gap_decisions" (
	"project_id" text NOT NULL,
	"keyword" text NOT NULL,
	"location_code" integer NOT NULL,
	"language_code" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"target_page_url" text,
	"opportunity_id" text,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "keyword_gap_decisions_project_id_keyword_location_code_language_code_pk" PRIMARY KEY("project_id","keyword","location_code","language_code")
);
--> statement-breakpoint
CREATE TABLE "keyword_gap_positions" (
	"row_id" text NOT NULL,
	"competitor_domain" text NOT NULL,
	"position" integer NOT NULL,
	"url" text,
	"traffic" real,
	CONSTRAINT "keyword_gap_positions_row_id_competitor_domain_pk" PRIMARY KEY("row_id","competitor_domain")
);
--> statement-breakpoint
CREATE TABLE "keyword_gap_rows" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"project_id" text NOT NULL,
	"keyword" text NOT NULL,
	"kind" text NOT NULL,
	"search_volume" integer,
	"keyword_difficulty" integer,
	"cpc" real,
	"intent" text,
	"competitor_count" integer NOT NULL,
	"best_position" integer NOT NULL,
	"best_domain" text NOT NULL,
	"best_url" text,
	"best_traffic" real,
	"target_position" integer,
	"target_url" text,
	"observed_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keyword_gap_run_competitors" (
	"run_id" text NOT NULL,
	"competitor_domain" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"rows_read" integer NOT NULL,
	"provider_total" integer,
	"error" text,
	CONSTRAINT "keyword_gap_run_competitors_run_id_competitor_domain_kind_pk" PRIMARY KEY("run_id","competitor_domain","kind")
);
--> statement-breakpoint
CREATE TABLE "keyword_gap_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"target_domain" text NOT NULL,
	"location_code" integer NOT NULL,
	"language_code" text NOT NULL,
	"rows_per_competitor" integer NOT NULL,
	"include_outranked" boolean NOT NULL,
	"estimated_usd" real NOT NULL,
	"cost_usd" real NOT NULL,
	"status" text NOT NULL,
	"row_count" integer NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_competitor_markets" (
	"competitor_id" text NOT NULL,
	"location_code" integer NOT NULL,
	"language_code" text NOT NULL,
	CONSTRAINT "project_competitor_markets_competitor_id_location_code_language_code_pk" PRIMARY KEY("competitor_id","location_code","language_code")
);
--> statement-breakpoint
CREATE TABLE "saved_table_views" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"table_key" text NOT NULL,
	"name" text NOT NULL,
	"config" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_competitors" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_competitors" ADD COLUMN "last_analysed_at" text;--> statement-breakpoint
ALTER TABLE "keyword_gap_decisions" ADD CONSTRAINT "keyword_gap_decisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_gap_positions" ADD CONSTRAINT "keyword_gap_positions_row_id_keyword_gap_rows_id_fk" FOREIGN KEY ("row_id") REFERENCES "public"."keyword_gap_rows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_gap_rows" ADD CONSTRAINT "keyword_gap_rows_run_id_keyword_gap_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."keyword_gap_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_gap_rows" ADD CONSTRAINT "keyword_gap_rows_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_gap_run_competitors" ADD CONSTRAINT "keyword_gap_run_competitors_run_id_keyword_gap_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."keyword_gap_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_gap_runs" ADD CONSTRAINT "keyword_gap_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_competitor_markets" ADD CONSTRAINT "project_competitor_markets_competitor_id_project_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."project_competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_table_views" ADD CONSTRAINT "saved_table_views_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "keyword_gap_rows_run_keyword_idx" ON "keyword_gap_rows" USING btree ("run_id","keyword");--> statement-breakpoint
CREATE INDEX "keyword_gap_rows_project_run_idx" ON "keyword_gap_rows" USING btree ("project_id","run_id");--> statement-breakpoint
CREATE INDEX "keyword_gap_runs_project_created_idx" ON "keyword_gap_runs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_table_views_project_table_name_idx" ON "saved_table_views" USING btree ("project_id","table_key","name");