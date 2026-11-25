CREATE TABLE `ai_crawler_cloudflare` (
	`project_id` text PRIMARY KEY NOT NULL,
	`sealed_token` text NOT NULL,
	`zone_id` text NOT NULL,
	`zone_name` text NOT NULL,
	`created_at` text NOT NULL,
	`last_synced_at` text,
	`last_error` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
