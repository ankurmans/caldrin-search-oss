CREATE TABLE `ai_observation_queries` (
	`id` text PRIMARY KEY NOT NULL,
	`observation_id` text NOT NULL,
	`query` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`observation_id`) REFERENCES `ai_observations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_observation_queries_observation_idx` ON `ai_observation_queries` (`observation_id`);--> statement-breakpoint
CREATE TABLE `ai_observation_retrievals` (
	`id` text PRIMARY KEY NOT NULL,
	`observation_id` text NOT NULL,
	`url` text NOT NULL,
	`domain` text NOT NULL,
	`title` text,
	`description` text,
	`position` integer NOT NULL,
	FOREIGN KEY (`observation_id`) REFERENCES `ai_observations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_observation_retrievals_observation_idx` ON `ai_observation_retrievals` (`observation_id`);--> statement-breakpoint
CREATE TABLE `ai_source_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`domain` text NOT NULL,
	`decision` text NOT NULL,
	`decided_at` text NOT NULL,
	`decided_by` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_source_decisions_project_domain_idx` ON `ai_source_decisions` (`project_id`,`domain`);--> statement-breakpoint
ALTER TABLE `ai_observations` ADD `queries_exposed` integer;--> statement-breakpoint
ALTER TABLE `ai_observations` ADD `retrieval_exposed` integer;--> statement-breakpoint
ALTER TABLE `ai_sources` ADD `origin` text;