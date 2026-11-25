ALTER TABLE `projects` ADD `starred` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `group_name` text;