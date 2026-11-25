CREATE TABLE `content_refresh_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`opportunity_id`) REFERENCES `content_opportunities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_refresh_jobs_project_opportunity` ON `content_refresh_jobs` (`project_id`,`opportunity_id`);--> statement-breakpoint
CREATE INDEX `content_refresh_jobs_batch` ON `content_refresh_jobs` (`batch_id`);--> statement-breakpoint
CREATE INDEX `content_refresh_jobs_status_time` ON `content_refresh_jobs` (`status`,`updated_at`);