CREATE TABLE "project_store_platforms" (
	"project_id" text PRIMARY KEY NOT NULL,
	"checked_domain" text NOT NULL,
	"detection" text NOT NULL,
	"evidence" text,
	"checked_at" text NOT NULL,
	"manual_shopify" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_store_platforms" ADD CONSTRAINT "project_store_platforms_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;