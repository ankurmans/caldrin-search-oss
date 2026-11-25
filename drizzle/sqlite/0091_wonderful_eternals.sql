CREATE TABLE `provider_health_events` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`provider` text NOT NULL,
	`operation` text NOT NULL,
	`source` text NOT NULL,
	`ok` integer NOT NULL,
	`kind` text,
	`http_status` integer,
	`message` text,
	`organization_id` text,
	`project_id` text
);
--> statement-breakpoint
CREATE INDEX `provider_health_events_created_idx` ON `provider_health_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `provider_health_events_operation_idx` ON `provider_health_events` (`operation`,`created_at`);