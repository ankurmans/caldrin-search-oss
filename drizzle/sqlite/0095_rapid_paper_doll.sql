CREATE TABLE `ai_prompt_volumes` (
	`prompt_id` text NOT NULL,
	`location_code` integer NOT NULL,
	`language_code` text NOT NULL,
	`volume` integer,
	`fetched_at` text NOT NULL,
	PRIMARY KEY(`prompt_id`, `location_code`, `language_code`),
	FOREIGN KEY (`prompt_id`) REFERENCES `ai_prompts`(`id`) ON UPDATE no action ON DELETE cascade
);
