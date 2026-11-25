CREATE TABLE `market_report_schedule_markets` (
	`schedule_id` text NOT NULL,
	`location_code` integer NOT NULL,
	`language_code` text NOT NULL,
	PRIMARY KEY(`schedule_id`, `location_code`, `language_code`),
	FOREIGN KEY (`schedule_id`) REFERENCES `market_report_schedules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `market_report_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`cadence` integer NOT NULL,
	`days` integer NOT NULL,
	`next_run_at` text NOT NULL,
	`last_status` text,
	`last_report_id` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_report_schedule_project_user` ON `market_report_schedules` (`project_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `market_report_next_run` ON `market_report_schedules` (`next_run_at`);