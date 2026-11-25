CREATE TABLE `platform_grace` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`teams` integer NOT NULL,
	`branding` integer NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `platform_subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`plan` text NOT NULL,
	`active` integer NOT NULL,
	`event_at` text NOT NULL,
	`renews_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `platform_subscription_org_idx` ON `platform_subscription` (`organization_id`);--> statement-breakpoint
INSERT INTO platform_grace (organization_id, teams, branding, expires_at)
SELECT id, teams, branding, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+45 days')
FROM (
  SELECT o.id,
    ((SELECT count(*) FROM member m WHERE m.organization_id = o.id) > 1
      OR EXISTS (SELECT 1 FROM invitation i WHERE i.organization_id = o.id
        AND i.status = 'pending' AND i.expires_at > unixepoch() * 1000)) AS teams,
    EXISTS (SELECT 1 FROM workspace_branding b WHERE b.organization_id = o.id) AS branding
  FROM organization o
) AS existing_access
WHERE teams OR branding;
