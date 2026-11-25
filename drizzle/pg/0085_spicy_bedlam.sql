CREATE TABLE "ai_crawler_cloudflare" (
	"project_id" text PRIMARY KEY NOT NULL,
	"sealed_token" text NOT NULL,
	"zone_id" text NOT NULL,
	"zone_name" text NOT NULL,
	"created_at" text NOT NULL,
	"last_synced_at" text,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "ai_crawler_cloudflare" ADD CONSTRAINT "ai_crawler_cloudflare_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;