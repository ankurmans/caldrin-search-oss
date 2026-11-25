CREATE TABLE `project_first_read_findings` (
	`read_key` text NOT NULL,
	`rank` integer NOT NULL,
	`kind` text NOT NULL,
	`subject` text NOT NULL,
	`metric` real NOT NULL,
	`related_metric` real,
	`page` text,
	`observed_at` text NOT NULL,
	`range_start` text,
	`range_end` text,
	PRIMARY KEY(`read_key`, `rank`),
	FOREIGN KEY (`read_key`) REFERENCES `project_first_reads`(`key`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `project_first_reads` (
	`key` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`completed_at` text NOT NULL,
	`search_console` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_first_reads_project_idx` ON `project_first_reads` (`project_id`);