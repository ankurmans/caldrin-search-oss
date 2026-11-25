CREATE TABLE "mcp_usage" (
	"organization_id" text NOT NULL,
	"bucket" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "mcp_usage_organization_id_bucket_pk" PRIMARY KEY("organization_id","bucket")
);
--> statement-breakpoint
ALTER TABLE "mcp_usage" ADD CONSTRAINT "mcp_usage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;