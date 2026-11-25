CREATE TABLE "ai_observation_queries" (
	"id" text PRIMARY KEY NOT NULL,
	"observation_id" text NOT NULL,
	"query" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_observation_retrievals" (
	"id" text PRIMARY KEY NOT NULL,
	"observation_id" text NOT NULL,
	"url" text NOT NULL,
	"domain" text NOT NULL,
	"title" text,
	"description" text,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_source_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"domain" text NOT NULL,
	"decision" text NOT NULL,
	"decided_at" text NOT NULL,
	"decided_by" text
);
--> statement-breakpoint
ALTER TABLE "ai_observations" ADD COLUMN "queries_exposed" boolean;--> statement-breakpoint
ALTER TABLE "ai_observations" ADD COLUMN "retrieval_exposed" boolean;--> statement-breakpoint
ALTER TABLE "ai_sources" ADD COLUMN "origin" text;--> statement-breakpoint
ALTER TABLE "ai_observation_queries" ADD CONSTRAINT "ai_observation_queries_observation_id_ai_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."ai_observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_observation_retrievals" ADD CONSTRAINT "ai_observation_retrievals_observation_id_ai_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."ai_observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_source_decisions" ADD CONSTRAINT "ai_source_decisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_observation_queries_observation_idx" ON "ai_observation_queries" USING btree ("observation_id");--> statement-breakpoint
CREATE INDEX "ai_observation_retrievals_observation_idx" ON "ai_observation_retrievals" USING btree ("observation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_source_decisions_project_domain_idx" ON "ai_source_decisions" USING btree ("project_id","domain");