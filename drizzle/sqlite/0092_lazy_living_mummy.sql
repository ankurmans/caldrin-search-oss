CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text,
	`actor_kind` text NOT NULL,
	`actor_user_id` text,
	`actor_label` text,
	`actor_client` text,
	`action` text NOT NULL,
	`target_kind` text,
	`target_id` text,
	`summary` text NOT NULL,
	`outcome` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_events_org_created_idx` ON `audit_events` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_org_action_idx` ON `audit_events` (`organization_id`,`action`,`created_at`);