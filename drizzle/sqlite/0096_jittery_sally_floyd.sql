CREATE TABLE `ai_crawler_hits` (
	`project_id` text NOT NULL,
	`day` text NOT NULL,
	`bot` text NOT NULL,
	`path` text NOT NULL,
	`status_class` integer NOT NULL,
	`hits` integer NOT NULL,
	PRIMARY KEY(`project_id`, `day`, `bot`, `path`, `status_class`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_crawler_hits_day_idx` ON `ai_crawler_hits` (`project_id`,`day`);--> statement-breakpoint
CREATE TABLE `ai_crawler_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`key_hash` text NOT NULL,
	`prefix` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_crawler_keys_project_idx` ON `ai_crawler_keys` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_crawler_keys_hash_idx` ON `ai_crawler_keys` (`key_hash`);