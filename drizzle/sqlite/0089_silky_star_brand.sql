CREATE TABLE `competitor_dismissals` (
	`project_id` text NOT NULL,
	`domain` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	PRIMARY KEY(`project_id`, `domain`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
