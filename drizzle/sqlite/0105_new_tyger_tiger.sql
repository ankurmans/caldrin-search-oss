CREATE TABLE `ai_perception_experiment_prompts` (
	`experiment_id` text NOT NULL,
	`prompt_id` text NOT NULL,
	PRIMARY KEY(`experiment_id`, `prompt_id`),
	FOREIGN KEY (`experiment_id`) REFERENCES `ai_perception_experiments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`prompt_id`) REFERENCES `ai_prompts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ai_perception_experiment_replays` (
	`id` text PRIMARY KEY NOT NULL,
	`experiment_id` text NOT NULL,
	`prompt_id` text NOT NULL,
	`arm` text NOT NULL,
	`repeat` integer NOT NULL,
	`answer_markdown` text NOT NULL,
	`named` integer NOT NULL,
	`stance` text,
	`sentiment` text,
	`evidence` text,
	`cost_usd` real NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`experiment_id`) REFERENCES `ai_perception_experiments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`prompt_id`) REFERENCES `ai_prompts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_perception_experiment_replays_slot_idx` ON `ai_perception_experiment_replays` (`experiment_id`,`prompt_id`,`arm`,`repeat`);--> statement-breakpoint
CREATE TABLE `ai_perception_experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`source_url` text,
	`original_text` text NOT NULL,
	`edited_text` text NOT NULL,
	`assumptions` text NOT NULL,
	`repeats` integer NOT NULL,
	`status` text NOT NULL,
	`brand_name` text NOT NULL,
	`brand_domain` text NOT NULL,
	`model` text,
	`opportunity_id` text,
	`cost_usd` real NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`replayed_at` text,
	`approved_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_perception_experiments_project_idx` ON `ai_perception_experiments` (`project_id`);