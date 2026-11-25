CREATE TABLE `wallet_refill_checkout` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`attempt` text NOT NULL,
	`amount_usd` integer NOT NULL,
	`expires_at` text NOT NULL,
	`checkout_url` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `wallet_refill_subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`amount_usd` integer NOT NULL,
	`status` text NOT NULL,
	`ends_after_period` integer NOT NULL,
	`period_end` text,
	`event_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `wallet_refill_subscription_org_idx` ON `wallet_refill_subscription` (`organization_id`);