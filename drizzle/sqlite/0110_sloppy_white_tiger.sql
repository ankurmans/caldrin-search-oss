CREATE TABLE `project_store_platforms` (
	`project_id` text PRIMARY KEY NOT NULL,
	`checked_domain` text NOT NULL,
	`detection` text NOT NULL,
	`evidence` text,
	`checked_at` text NOT NULL,
	`manual_shopify` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
