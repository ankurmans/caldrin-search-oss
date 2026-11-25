CREATE TABLE `ai_prompt_set_members` (
	`version_id` text NOT NULL,
	`prompt_id` text NOT NULL,
	PRIMARY KEY(`version_id`, `prompt_id`),
	FOREIGN KEY (`version_id`) REFERENCES `ai_prompt_set_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`prompt_id`) REFERENCES `ai_prompts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ai_prompt_set_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`tracker_id` text NOT NULL,
	`version` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tracker_id`) REFERENCES `ai_trackers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_prompt_set_versions_tracker_version_idx` ON `ai_prompt_set_versions` (`tracker_id`,`version`);--> statement-breakpoint
CREATE TABLE `change_ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`opportunity_id` text,
	`kind` text NOT NULL,
	`provider` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`publication_status` text DEFAULT 'not_started' NOT NULL,
	`target_url` text,
	`content_asset_id` text,
	`content_revision` integer,
	`external_id` text,
	`proposed_action` text NOT NULL,
	`before_state` text,
	`after_state` text,
	`diff` text,
	`requested_by_user_id` text NOT NULL,
	`approved_by_user_id` text,
	`approved_at` text,
	`approved_revision` integer,
	`executed_by_user_id` text,
	`executed_at` text,
	`error` text,
	`rollback_kind` text DEFAULT 'none' NOT NULL,
	`rollback_payload` text,
	`rolled_back_at` text,
	`rolled_back_by_user_id` text,
	`measurement_metric` text,
	`measurement_window_days` integer,
	`baseline_start` text,
	`baseline_end` text,
	`final_decision` text,
	`final_decided_by_user_id` text,
	`final_decided_at` text,
	`idempotency_key` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`opportunity_id`) REFERENCES `content_opportunities`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`content_asset_id`) REFERENCES `content_assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `change_ledger_entries_idempotency_idx` ON `change_ledger_entries` (`project_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `change_ledger_entries_project_idx` ON `change_ledger_entries` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `change_ledger_entries_opportunity_idx` ON `change_ledger_entries` (`opportunity_id`);--> statement-breakpoint
CREATE TABLE `change_ledger_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`source` text NOT NULL,
	`label` text NOT NULL,
	`value` text NOT NULL,
	`url` text,
	`observed_at` text,
	FOREIGN KEY (`entry_id`) REFERENCES `change_ledger_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `change_ledger_evidence_entry_idx` ON `change_ledger_evidence` (`entry_id`);--> statement-breakpoint
CREATE TABLE `change_ledger_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`phase` text NOT NULL,
	`source` text NOT NULL,
	`metric` text NOT NULL,
	`value` real NOT NULL,
	`numerator` real,
	`denominator` real,
	`window_start` text,
	`window_end` text,
	`observed_at` text NOT NULL,
	`ai_run_id` text,
	`note` text,
	FOREIGN KEY (`entry_id`) REFERENCES `change_ledger_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `change_ledger_observations_entry_idx` ON `change_ledger_observations` (`entry_id`);--> statement-breakpoint
CREATE TABLE `opportunity_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`opportunity_id` text NOT NULL,
	`source` text NOT NULL,
	`label` text NOT NULL,
	`value` text NOT NULL,
	`url` text,
	`observed_at` text,
	FOREIGN KEY (`opportunity_id`) REFERENCES `content_opportunities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `opportunity_evidence_opportunity_idx` ON `opportunity_evidence` (`opportunity_id`);--> statement-breakpoint
CREATE TABLE `project_spend_limits` (
	`project_id` text PRIMARY KEY NOT NULL,
	`daily_usd` real,
	`monthly_usd` real,
	`scheduled_jobs_per_day` integer,
	`updated_by_user_id` text NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `provider_costs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`ledger_entry_id` text,
	`provider` text NOT NULL,
	`operation` text NOT NULL,
	`estimated_usd` real,
	`cost_usd` real NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ledger_entry_id`) REFERENCES `change_ledger_entries`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `provider_costs_project_idx` ON `provider_costs` (`project_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `ai_matches` ADD `recommended` integer;--> statement-breakpoint
ALTER TABLE `ai_observations` ADD `model` text;--> statement-breakpoint
ALTER TABLE `ai_runs` ADD `prompt_set_version_id` text;--> statement-breakpoint
ALTER TABLE `content_opportunities` ADD `intent` text;--> statement-breakpoint
ALTER TABLE `content_opportunities` ADD `priority` text;--> statement-breakpoint
ALTER TABLE `content_opportunities` ADD `priority_reason` text;--> statement-breakpoint
ALTER TABLE `content_opportunities` ADD `observed_at` text;