CREATE TABLE `keyword_gap_decisions` (
	`project_id` text NOT NULL,
	`keyword` text NOT NULL,
	`location_code` integer NOT NULL,
	`language_code` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`target_page_url` text,
	`opportunity_id` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_by` text NOT NULL,
	PRIMARY KEY(`project_id`, `keyword`, `location_code`, `language_code`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `keyword_gap_positions` (
	`row_id` text NOT NULL,
	`competitor_domain` text NOT NULL,
	`position` integer NOT NULL,
	`url` text,
	`traffic` real,
	PRIMARY KEY(`row_id`, `competitor_domain`),
	FOREIGN KEY (`row_id`) REFERENCES `keyword_gap_rows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `keyword_gap_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`project_id` text NOT NULL,
	`keyword` text NOT NULL,
	`kind` text NOT NULL,
	`search_volume` integer,
	`keyword_difficulty` integer,
	`cpc` real,
	`intent` text,
	`competitor_count` integer NOT NULL,
	`best_position` integer NOT NULL,
	`best_domain` text NOT NULL,
	`best_url` text,
	`best_traffic` real,
	`target_position` integer,
	`target_url` text,
	`observed_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `keyword_gap_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `keyword_gap_rows_run_keyword_idx` ON `keyword_gap_rows` (`run_id`,`keyword`);--> statement-breakpoint
CREATE INDEX `keyword_gap_rows_project_run_idx` ON `keyword_gap_rows` (`project_id`,`run_id`);--> statement-breakpoint
CREATE TABLE `keyword_gap_run_competitors` (
	`run_id` text NOT NULL,
	`competitor_domain` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`rows_read` integer NOT NULL,
	`provider_total` integer,
	`error` text,
	PRIMARY KEY(`run_id`, `competitor_domain`, `kind`),
	FOREIGN KEY (`run_id`) REFERENCES `keyword_gap_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `keyword_gap_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`target_domain` text NOT NULL,
	`location_code` integer NOT NULL,
	`language_code` text NOT NULL,
	`rows_per_competitor` integer NOT NULL,
	`include_outranked` integer NOT NULL,
	`estimated_usd` real NOT NULL,
	`cost_usd` real NOT NULL,
	`status` text NOT NULL,
	`row_count` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `keyword_gap_runs_project_created_idx` ON `keyword_gap_runs` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `project_competitor_markets` (
	`competitor_id` text NOT NULL,
	`location_code` integer NOT NULL,
	`language_code` text NOT NULL,
	PRIMARY KEY(`competitor_id`, `location_code`, `language_code`),
	FOREIGN KEY (`competitor_id`) REFERENCES `project_competitors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `saved_table_views` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`table_key` text NOT NULL,
	`name` text NOT NULL,
	`config` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saved_table_views_project_table_name_idx` ON `saved_table_views` (`project_id`,`table_key`,`name`);--> statement-breakpoint
ALTER TABLE `project_competitors` ADD `source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `project_competitors` ADD `last_analysed_at` text;