CREATE TABLE "ai_brand_facts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"statement" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_fact_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"fact_id" text NOT NULL,
	"observation_id" text NOT NULL,
	"verdict" text NOT NULL,
	"quote" text,
	"model" text NOT NULL,
	"checked_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_brand_facts" ADD CONSTRAINT "ai_brand_facts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_fact_checks" ADD CONSTRAINT "ai_fact_checks_fact_id_ai_brand_facts_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."ai_brand_facts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_fact_checks" ADD CONSTRAINT "ai_fact_checks_observation_id_ai_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."ai_observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_brand_facts_project_idx" ON "ai_brand_facts" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_fact_checks_fact_obs_idx" ON "ai_fact_checks" USING btree ("fact_id","observation_id");--> statement-breakpoint
CREATE INDEX "ai_fact_checks_obs_idx" ON "ai_fact_checks" USING btree ("observation_id");