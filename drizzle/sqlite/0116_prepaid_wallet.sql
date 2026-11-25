CREATE TABLE `wallet_account` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `wallet_order` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`purchased_credits` integer NOT NULL,
	`refunded_credits` integer NOT NULL,
	`event_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `wallet_account`(`organization_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `wallet_order_org_idx` ON `wallet_order` (`organization_id`);--> statement-breakpoint
CREATE TABLE `wallet_run` (
	`run_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`reserved` integer NOT NULL,
	`charged` integer,
	`standard_rate` integer NOT NULL,
	`claude_rate` integer NOT NULL,
	`perplexity_rate` integer NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `wallet_account`(`organization_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `wallet_run_org_idx` ON `wallet_run` (`organization_id`);--> statement-breakpoint
CREATE INDEX `wallet_run_expiry_idx` ON `wallet_run` (`charged`,`expires_at`);