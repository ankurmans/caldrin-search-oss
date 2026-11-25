ALTER TABLE `wallet_order` ADD `period_start` text;--> statement-breakpoint
ALTER TABLE `wallet_order` ADD `period_end` text;--> statement-breakpoint
ALTER TABLE `wallet_run` ADD `included_order_id` text REFERENCES wallet_order(id);--> statement-breakpoint
ALTER TABLE `wallet_run` ADD `included_reserved` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `wallet_run` ADD `included_charged` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `wallet_run_included_order_idx` ON `wallet_run` (`included_order_id`);