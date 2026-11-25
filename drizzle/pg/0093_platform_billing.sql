CREATE TABLE "platform_grace" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"teams" boolean NOT NULL,
	"branding" boolean NOT NULL,
	"expires_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"plan" text NOT NULL,
	"active" boolean NOT NULL,
	"event_at" text NOT NULL,
	"renews_at" text
);
--> statement-breakpoint
ALTER TABLE "platform_grace" ADD CONSTRAINT "platform_grace_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_subscription" ADD CONSTRAINT "platform_subscription_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_subscription_org_idx" ON "platform_subscription" USING btree ("organization_id");--> statement-breakpoint
INSERT INTO platform_grace (organization_id, teams, branding, expires_at)
SELECT id, teams, branding, to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + interval '45 days', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM (
  SELECT o.id,
    ((SELECT count(*) FROM member m WHERE m.organization_id = o.id) > 1
      OR EXISTS (SELECT 1 FROM invitation i WHERE i.organization_id = o.id
        AND i.status = 'pending' AND i.expires_at > CURRENT_TIMESTAMP)) AS teams,
    EXISTS (SELECT 1 FROM workspace_branding b WHERE b.organization_id = o.id) AS branding
  FROM organization o
) AS existing_access
WHERE teams OR branding;
