CREATE TABLE "attribution_connectors" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"sealed_secret" text NOT NULL,
	"created_at" text NOT NULL,
	"last_event_at" text,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"last_failure_at" text,
	"last_failure" text
);
--> statement-breakpoint
ALTER TABLE "attribution_conversions" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "attribution_connectors" ADD CONSTRAINT "attribution_connectors_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attribution_connectors_project_idx" ON "attribution_connectors" USING btree ("project_id","kind");