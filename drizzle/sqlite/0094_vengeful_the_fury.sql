CREATE TABLE `ai_tracker_markets` (
	`tracker_id` text NOT NULL,
	`location_code` integer NOT NULL,
	`language_code` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`tracker_id`, `location_code`, `language_code`),
	FOREIGN KEY (`tracker_id`) REFERENCES `ai_trackers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
DROP INDEX `ai_runs_one_active_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `ai_runs_one_active_idx` ON `ai_runs` (`tracker_id`,`location_code`,`language_code`) WHERE "ai_runs"."status" IN ('queued', 'running');