CREATE TABLE `ai_perception_comparisons` (
	`id` text PRIMARY KEY NOT NULL,
	`perception_id` text NOT NULL,
	`competitor_domain` text NOT NULL,
	`competitor_name` text NOT NULL,
	`outcome` text NOT NULL,
	FOREIGN KEY (`perception_id`) REFERENCES `ai_perceptions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_perception_comparisons_perception_competitor_idx` ON `ai_perception_comparisons` (`perception_id`,`competitor_domain`);--> statement-breakpoint
CREATE TABLE `ai_perception_points` (
	`id` text PRIMARY KEY NOT NULL,
	`perception_id` text NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`quote` text NOT NULL,
	FOREIGN KEY (`perception_id`) REFERENCES `ai_perceptions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_perception_points_perception_idx` ON `ai_perception_points` (`perception_id`);--> statement-breakpoint
CREATE TABLE `ai_perception_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`perception_id` text NOT NULL,
	`field` text NOT NULL,
	`from_value` text NOT NULL,
	`to_value` text NOT NULL,
	`note` text,
	`reviewed_by` text,
	`reviewed_at` text NOT NULL,
	FOREIGN KEY (`perception_id`) REFERENCES `ai_perceptions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_perception_reviews_perception_idx` ON `ai_perception_reviews` (`perception_id`);--> statement-breakpoint
CREATE TABLE `ai_perceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`observation_id` text NOT NULL,
	`domain` text NOT NULL,
	`name` text NOT NULL,
	`own` integer NOT NULL,
	`stance` text NOT NULL,
	`sentiment` text NOT NULL,
	`confidence` text NOT NULL,
	`evidence` text,
	`ambiguous_name` integer NOT NULL,
	`classifier_version` text NOT NULL,
	`model` text NOT NULL,
	`classified_at` text NOT NULL,
	`reviewed_stance` text,
	`reviewed_sentiment` text,
	FOREIGN KEY (`observation_id`) REFERENCES `ai_observations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_perceptions_obs_domain_version_idx` ON `ai_perceptions` (`observation_id`,`domain`,`classifier_version`);--> statement-breakpoint
CREATE INDEX `ai_perceptions_observation_idx` ON `ai_perceptions` (`observation_id`);