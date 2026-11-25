CREATE TABLE "workspace_branding" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"brand_name" text NOT NULL,
	"logo_url" text,
	"accent_color" text,
	"hide_attribution" boolean NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_branding" ADD CONSTRAINT "workspace_branding_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;