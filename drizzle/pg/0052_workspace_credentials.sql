CREATE TABLE "workspace_credentials" (
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"api_key_encrypted" text NOT NULL,
	"key_hint" text NOT NULL,
	"account_id" text,
	"model_fast" text,
	"model_smart" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "workspace_credentials_organization_id_kind_pk" PRIMARY KEY("organization_id","kind")
);
--> statement-breakpoint
CREATE TABLE "workspace_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'byok' NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_credentials" ADD CONSTRAINT "workspace_credentials_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
