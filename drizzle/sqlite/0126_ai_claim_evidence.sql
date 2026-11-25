CREATE TABLE `ai_claim_source_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`occurrence_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`relation` text NOT NULL,
	`relevance` text NOT NULL,
	`rationale` text NOT NULL,
	`reviewer_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`occurrence_id`) REFERENCES `ai_claim_occurrences`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`snapshot_id`) REFERENCES `ai_claim_source_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_claim_source_reviews_occurrence` ON `ai_claim_source_reviews` (`project_id`,`occurrence_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `ai_claim_extractions` ADD `resolved_model` text;--> statement-breakpoint
ALTER TABLE `ai_claim_source_snapshots` ADD `matching_passage` text;