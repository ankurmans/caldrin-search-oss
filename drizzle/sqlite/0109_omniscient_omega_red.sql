CREATE TABLE `attribution_connectors` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`sealed_secret` text NOT NULL,
	`created_at` text NOT NULL,
	`last_event_at` text,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`last_failure_at` text,
	`last_failure` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attribution_connectors_project_idx` ON `attribution_connectors` (`project_id`,`kind`);--> statement-breakpoint
ALTER TABLE `attribution_conversions` ADD `is_demo` integer DEFAULT false NOT NULL;