CREATE TABLE `monitoring_job_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`job` text NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`attempt` integer NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`idempotency_key` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `monitoring_job_runs_idempotency_idx` ON `monitoring_job_runs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `monitoring_job_runs_project_idx` ON `monitoring_job_runs` (`project_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `project_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`details_json` text NOT NULL,
	`comparable` integer NOT NULL,
	`dedupe_key` text NOT NULL,
	`created_at` text NOT NULL,
	`read_at` text,
	`emailed_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_alerts_project_dedupe_idx` ON `project_alerts` (`project_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `project_alerts_project_created_idx` ON `project_alerts` (`project_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `ai_matches` ADD `extraction_version` text;--> statement-breakpoint
ALTER TABLE `ai_prompts` ADD `intent` text;