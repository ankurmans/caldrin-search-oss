CREATE TABLE "source_page_analyses" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"summary" text NOT NULL,
	"page_kind" text NOT NULL,
	"names_brand" boolean NOT NULL,
	"model" text,
	"cost_usd" real NOT NULL,
	"analysed_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_page_analysis_items" (
	"id" text PRIMARY KEY NOT NULL,
	"analysis_id" text NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_page_analyses" ADD CONSTRAINT "source_page_analyses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_page_analysis_items" ADD CONSTRAINT "source_page_analysis_items_analysis_id_source_page_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."source_page_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_page_analyses_project_url_idx" ON "source_page_analyses" USING btree ("project_id","url");--> statement-breakpoint
CREATE INDEX "source_page_analysis_items_analysis_idx" ON "source_page_analysis_items" USING btree ("analysis_id");