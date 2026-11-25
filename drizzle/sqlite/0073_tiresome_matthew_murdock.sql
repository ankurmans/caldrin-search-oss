CREATE TABLE `invitation_project_access` (
	`invitation_id` text NOT NULL,
	`project_id` text NOT NULL,
	PRIMARY KEY(`invitation_id`, `project_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `project_access` (
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	PRIMARY KEY(`user_id`, `project_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_access_project_idx` ON `project_access` (`project_id`);--> statement-breakpoint
CREATE INDEX `project_access_org_idx` ON `project_access` (`organization_id`);