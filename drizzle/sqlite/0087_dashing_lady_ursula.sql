CREATE TABLE `source_page_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text,
	`summary` text NOT NULL,
	`page_kind` text NOT NULL,
	`names_brand` integer NOT NULL,
	`model` text,
	`cost_usd` real NOT NULL,
	`analysed_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_page_analyses_project_url_idx` ON `source_page_analyses` (`project_id`,`url`);--> statement-breakpoint
CREATE TABLE `source_page_analysis_items` (
	`id` text PRIMARY KEY NOT NULL,
	`analysis_id` text NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`analysis_id`) REFERENCES `source_page_analyses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `source_page_analysis_items_analysis_idx` ON `source_page_analysis_items` (`analysis_id`);