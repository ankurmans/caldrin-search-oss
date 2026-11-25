CREATE TABLE "alert_destinations" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"email_enabled" boolean DEFAULT false NOT NULL,
	"slack_webhook_sealed" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_destinations" ADD CONSTRAINT "alert_destinations_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;