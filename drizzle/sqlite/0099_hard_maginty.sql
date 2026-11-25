ALTER TABLE `local_rank_trackers` ADD `schedule_interval` text;--> statement-breakpoint
ALTER TABLE `local_rank_trackers` ADD `next_check_at` text;--> statement-breakpoint
ALTER TABLE `local_rank_trackers` ADD `last_skip_reason` text;--> statement-breakpoint
CREATE INDEX `local_rank_trackers_due_idx` ON `local_rank_trackers` (`next_check_at`);