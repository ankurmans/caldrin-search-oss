CREATE TABLE `content_asset_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`revision` integer NOT NULL,
	`title` text NOT NULL,
	`body_html` text NOT NULL,
	`meta_title` text NOT NULL,
	`meta_description` text NOT NULL,
	`edited_by_user_id` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `content_assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_asset_versions_unique_idx` ON `content_asset_versions` (`asset_id`,`revision`);