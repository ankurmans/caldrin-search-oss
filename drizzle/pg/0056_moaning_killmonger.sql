CREATE TABLE "content_asset_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"revision" integer NOT NULL,
	"title" text NOT NULL,
	"body_html" text NOT NULL,
	"meta_title" text NOT NULL,
	"meta_description" text NOT NULL,
	"edited_by_user_id" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_asset_versions" ADD CONSTRAINT "content_asset_versions_asset_id_content_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."content_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_asset_versions_unique_idx" ON "content_asset_versions" USING btree ("asset_id","revision");