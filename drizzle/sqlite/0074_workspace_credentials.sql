CREATE TABLE `workspace_credentials` (
	`organization_id` text NOT NULL,
	`kind` text NOT NULL,
	`provider` text NOT NULL,
	`api_key_encrypted` text NOT NULL,
	`key_hint` text NOT NULL,
	`account_id` text,
	`model_fast` text,
	`model_smart` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	PRIMARY KEY(`organization_id`, `kind`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workspace_settings` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'byok' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
