CREATE TABLE `coding_agent_panels` (
	`project_id` text NOT NULL,
	`id` text NOT NULL,
	`mode` text NOT NULL,
	`prompt` text NOT NULL,
	`model` text NOT NULL,
	`captured_at` text NOT NULL,
	PRIMARY KEY(`project_id`, `id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `coding_agent_panels_project_capture_idx` ON `coding_agent_panels` (`project_id`,`captured_at`);--> statement-breakpoint
CREATE TABLE `coding_agent_runs` (
	`project_id` text NOT NULL,
	`panel_id` text NOT NULL,
	`slot` integer NOT NULL,
	`answer` text NOT NULL,
	`query` text,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`list_rate_micro_usd` integer NOT NULL,
	`lookup_cost_micro_usd` integer,
	PRIMARY KEY(`project_id`, `panel_id`, `slot`),
	FOREIGN KEY (`project_id`,`panel_id`) REFERENCES `coding_agent_panels`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `coding_agent_sources` (
	`project_id` text NOT NULL,
	`panel_id` text NOT NULL,
	`slot` integer NOT NULL,
	`url` text NOT NULL,
	`evidence` text NOT NULL,
	PRIMARY KEY(`project_id`, `panel_id`, `slot`, `url`, `evidence`),
	FOREIGN KEY (`project_id`,`panel_id`,`slot`) REFERENCES `coding_agent_runs`(`project_id`,`panel_id`,`slot`) ON UPDATE no action ON DELETE cascade
);
