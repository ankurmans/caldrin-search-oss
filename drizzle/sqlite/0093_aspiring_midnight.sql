CREATE TABLE `alert_destinations` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`email_enabled` integer DEFAULT false NOT NULL,
	`slack_webhook_sealed` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
