CREATE TABLE `content_asset_references` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`ref_type` text NOT NULL,
	`handle` text NOT NULL,
	`title` text NOT NULL,
	`available` integer NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `content_assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_asset_references_unique_idx` ON `content_asset_references` (`asset_id`,`ref_type`,`handle`);--> statement-breakpoint
CREATE TABLE `content_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`opportunity_id` text,
	`title` text NOT NULL,
	`search_intent` text NOT NULL,
	`brief_markdown` text NOT NULL,
	`body_html` text NOT NULL,
	`meta_title` text NOT NULL,
	`meta_description` text NOT NULL,
	`generator` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`approved_by_user_id` text,
	`approved_revision` integer,
	`approved_at` text,
	`created_by_user_id` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`opportunity_id`) REFERENCES `content_opportunities`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `content_assets_project_idx` ON `content_assets` (`project_id`);--> statement-breakpoint
CREATE INDEX `content_assets_opportunity_idx` ON `content_assets` (`opportunity_id`);--> statement-breakpoint
CREATE TABLE `content_opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`query` text NOT NULL,
	`page_url` text,
	`impressions` integer NOT NULL,
	`clicks` integer NOT NULL,
	`ctr` real NOT NULL,
	`position` real NOT NULL,
	`window_start` text NOT NULL,
	`window_end` text NOT NULL,
	`recommended_action` text NOT NULL,
	`reason` text NOT NULL,
	`matched_collection_handle` text,
	`data_source` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_opportunities_dedupe_idx` ON `content_opportunities` (`project_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `content_opportunities_org_idx` ON `content_opportunities` (`organization_id`);--> statement-breakpoint
CREATE TABLE `content_provider_costs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`asset_id` text,
	`provider` text NOT NULL,
	`operation` text NOT NULL,
	`cost_usd` real NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `content_assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `content_provider_costs_project_idx` ON `content_provider_costs` (`project_id`);--> statement-breakpoint
CREATE TABLE `content_publications` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`revision` integer NOT NULL,
	`connector` text NOT NULL,
	`mode` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`external_id` text,
	`external_url` text,
	`state` text NOT NULL,
	`error` text,
	`requested_by_user_id` text NOT NULL,
	`published_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `content_assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_publications_idempotency_idx` ON `content_publications` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `content_publications_asset_idx` ON `content_publications` (`asset_id`);--> statement-breakpoint
CREATE TABLE `content_quality_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`revision` integer NOT NULL,
	`check_key` text NOT NULL,
	`severity` text NOT NULL,
	`passed` integer NOT NULL,
	`detail` text NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `content_assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_quality_checks_unique_idx` ON `content_quality_checks` (`asset_id`,`revision`,`check_key`);--> statement-breakpoint
CREATE TABLE `shopify_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`shop_domain` text NOT NULL,
	`mode` text NOT NULL,
	`sealed_access_token` text,
	`sealed_refresh_token` text,
	`access_token_expires_at` text,
	`refresh_token_expires_at` text,
	`granted_scopes` text DEFAULT '' NOT NULL,
	`can_publish` integer DEFAULT false NOT NULL,
	`api_version` text NOT NULL,
	`connected_by_user_id` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shopify_connections_project_idx` ON `shopify_connections` (`project_id`);--> statement-breakpoint
CREATE INDEX `shopify_connections_organization_idx` ON `shopify_connections` (`organization_id`);