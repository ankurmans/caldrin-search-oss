CREATE TABLE "ai_crawler_hits" (
	"project_id" text NOT NULL,
	"day" text NOT NULL,
	"bot" text NOT NULL,
	"path" text NOT NULL,
	"status_class" integer NOT NULL,
	"hits" integer NOT NULL,
	CONSTRAINT "ai_crawler_hits_project_id_day_bot_path_status_class_pk" PRIMARY KEY("project_id","day","bot","path","status_class")
);
--> statement-breakpoint
CREATE TABLE "ai_crawler_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"key_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"created_at" text NOT NULL,
	"last_used_at" text
);
--> statement-breakpoint
ALTER TABLE "ai_crawler_hits" ADD CONSTRAINT "ai_crawler_hits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_crawler_keys" ADD CONSTRAINT "ai_crawler_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_crawler_hits_day_idx" ON "ai_crawler_hits" USING btree ("project_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_crawler_keys_project_idx" ON "ai_crawler_keys" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_crawler_keys_hash_idx" ON "ai_crawler_keys" USING btree ("key_hash");