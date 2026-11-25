CREATE TABLE `ai_brand_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`statement` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_brand_facts_project_idx` ON `ai_brand_facts` (`project_id`);--> statement-breakpoint
CREATE TABLE `ai_fact_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`fact_id` text NOT NULL,
	`observation_id` text NOT NULL,
	`verdict` text NOT NULL,
	`quote` text,
	`model` text NOT NULL,
	`checked_at` text NOT NULL,
	FOREIGN KEY (`fact_id`) REFERENCES `ai_brand_facts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`observation_id`) REFERENCES `ai_observations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_fact_checks_fact_obs_idx` ON `ai_fact_checks` (`fact_id`,`observation_id`);--> statement-breakpoint
CREATE INDEX `ai_fact_checks_obs_idx` ON `ai_fact_checks` (`observation_id`);