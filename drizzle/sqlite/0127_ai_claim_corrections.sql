CREATE TABLE `ai_claim_corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`assessment_id` text,
	`claim_id` text,
	`opportunity_id` text NOT NULL,
	`asset_id` text,
	`outreach_draft` text,
	`ledger_id` text,
	`kind` text NOT NULL,
	`target_url` text NOT NULL,
	`baseline_run_id` text,
	`baseline_observation_id` text,
	`fact_version_id` text NOT NULL,
	`before_snapshot_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assessment_id`) REFERENCES `ai_claim_assessments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`claim_id`) REFERENCES `ai_claims`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`opportunity_id`) REFERENCES `content_opportunities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `content_assets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`ledger_id`) REFERENCES `change_ledger_entries`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`baseline_run_id`) REFERENCES `ai_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`baseline_observation_id`) REFERENCES `ai_observations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`fact_version_id`) REFERENCES `ai_claim_fact_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`before_snapshot_id`) REFERENCES `ai_claim_source_snapshots`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ai_claim_corrections_project` ON `ai_claim_corrections` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_claim_followups` (
	`id` text PRIMARY KEY NOT NULL,
	`correction_id` text NOT NULL,
	`ledger_id` text NOT NULL,
	`observation_id` text NOT NULL,
	`outcome` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`correction_id`) REFERENCES `ai_claim_corrections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ledger_id`) REFERENCES `change_ledger_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`observation_id`) REFERENCES `ai_observations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_claim_followups_observation` ON `ai_claim_followups` (`correction_id`,`observation_id`);--> statement-breakpoint
CREATE TABLE `ai_claim_group_history` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`claim_id` text NOT NULL,
	`previous_target` text,
	`target` text,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`claim_id`) REFERENCES `ai_claims`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_claim_group_history_claim` ON `ai_claim_group_history` (`claim_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `ai_claim_jobs` ADD `credits_per_answer` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_claim_jobs` ADD `billing_error` text;