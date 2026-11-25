CREATE TABLE `source_gap_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`prompt_id` text NOT NULL,
	`created_at` text NOT NULL,
	`previous_analysis_id` text,
	`owner_url` text,
	`owner_confidence` text,
	`owner_overridden` integer NOT NULL,
	`top_root_cause` text,
	`sources_analyzed` integer NOT NULL,
	`collection_mode` text NOT NULL,
	`opportunity_id` text,
	`result_json` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`prompt_id`) REFERENCES `ai_prompts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `source_gap_analyses_prompt_created_idx` ON `source_gap_analyses` (`project_id`,`prompt_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `source_gap_owner_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`prompt_id` text NOT NULL,
	`owner_url` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`prompt_id`) REFERENCES `ai_prompts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_gap_owner_overrides_prompt_idx` ON `source_gap_owner_overrides` (`project_id`,`prompt_id`);--> statement-breakpoint
CREATE TABLE `source_page_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`url` text NOT NULL,
	`normalized_url` text NOT NULL,
	`status` text NOT NULL,
	`http_status` integer,
	`fetched_at` text NOT NULL,
	`content_hash` text,
	`rendered` integer NOT NULL,
	`parsed_json` text,
	`note` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `source_page_snapshots_project_url_idx` ON `source_page_snapshots` (`project_id`,`normalized_url`,`fetched_at`);