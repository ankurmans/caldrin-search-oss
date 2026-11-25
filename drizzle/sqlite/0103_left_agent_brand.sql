CREATE TABLE `ai_observation_products` (
	`id` text PRIMARY KEY NOT NULL,
	`observation_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`price` real,
	`currency` text,
	`tag` text,
	`provider_field` text NOT NULL,
	FOREIGN KEY (`observation_id`) REFERENCES `ai_observations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_observation_products_observation_idx` ON `ai_observation_products` (`observation_id`);