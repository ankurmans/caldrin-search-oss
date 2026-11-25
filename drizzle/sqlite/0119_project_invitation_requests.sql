CREATE TABLE `project_invitation_request` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`requester_id` text NOT NULL,
	`email` text NOT NULL,
	`created_at` text NOT NULL,
	`status` text NOT NULL,
	`reviewed_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requester_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_invite_request_email_idx` ON `project_invitation_request` (`organization_id`,`project_id`,`email`);--> statement-breakpoint
CREATE INDEX `project_invite_request_status_idx` ON `project_invitation_request` (`organization_id`,`status`);