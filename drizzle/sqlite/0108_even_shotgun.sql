CREATE TABLE `attribution_brands` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attribution_brands_slug_idx` ON `attribution_brands` (`project_id`,`slug`);--> statement-breakpoint
CREATE TABLE `attribution_event_identifiers` (
	`event_id` text NOT NULL,
	`project_id` text NOT NULL,
	`identifier_type` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`event_id`, `identifier_type`),
	FOREIGN KEY (`event_id`) REFERENCES `attribution_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attribution_identifiers_value_idx` ON `attribution_event_identifiers` (`project_id`,`identifier_type`,`value`);--> statement-breakpoint
CREATE TABLE `attribution_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`property_id` text,
	`brand_id` text,
	`intended_brand_id` text,
	`event_type` text NOT NULL,
	`source_system` text NOT NULL,
	`source_event_id` text NOT NULL,
	`origin` text NOT NULL,
	`occurred_at` text NOT NULL,
	`ingested_at` text NOT NULL,
	`import_batch_id` text,
	`session_id` text,
	`landing_host` text,
	`landing_path` text,
	`page_path` text,
	`referrer_host` text,
	`referrer_path` text,
	`utm_source` text,
	`utm_medium` text,
	`utm_campaign` text,
	`utm_term` text,
	`utm_content` text,
	`click_id_kind` text,
	`click_id` text,
	`self_reported_source` text,
	`stage` text,
	`amount_minor` integer,
	`currency` text,
	`parent_source_event_id` text,
	`payload` text,
	`payload_key` text,
	`is_test` integer DEFAULT false NOT NULL,
	`is_bot` integer DEFAULT false NOT NULL,
	`consent` text DEFAULT 'granted' NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `attribution_properties`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`brand_id`) REFERENCES `attribution_brands`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`intended_brand_id`) REFERENCES `attribution_brands`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`import_batch_id`) REFERENCES `attribution_import_batches`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attribution_events_source_idx` ON `attribution_events` (`project_id`,`source_system`,`source_event_id`);--> statement-breakpoint
CREATE INDEX `attribution_events_time_idx` ON `attribution_events` (`project_id`,`event_type`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `attribution_events_batch_idx` ON `attribution_events` (`import_batch_id`);--> statement-breakpoint
CREATE INDEX `attribution_events_parent_idx` ON `attribution_events` (`project_id`,`parent_source_event_id`);--> statement-breakpoint
CREATE TABLE `attribution_import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source_system` text NOT NULL,
	`label` text NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`received_count` integer DEFAULT 0 NOT NULL,
	`accepted_count` integer DEFAULT 0 NOT NULL,
	`duplicate_count` integer DEFAULT 0 NOT NULL,
	`rejected_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attribution_batches_project_idx` ON `attribution_import_batches` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `attribution_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`key_hash` text NOT NULL,
	`prefix` text NOT NULL,
	`public_value` text,
	`created_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attribution_keys_hash_idx` ON `attribution_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `attribution_keys_project_idx` ON `attribution_keys` (`project_id`,`kind`);--> statement-breakpoint
CREATE TABLE `attribution_properties` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`brand_id` text,
	`name` text NOT NULL,
	`host` text NOT NULL,
	`created_at` text NOT NULL,
	`verified_at` text,
	`last_event_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`brand_id`) REFERENCES `attribution_brands`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attribution_properties_host_idx` ON `attribution_properties` (`project_id`,`host`);--> statement-breakpoint
CREATE TABLE `attribution_rejections` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`import_batch_id` text,
	`source_system` text NOT NULL,
	`reason` text NOT NULL,
	`detail` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_batch_id`) REFERENCES `attribution_import_batches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attribution_rejections_project_idx` ON `attribution_rejections` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `attribution_settings` (
	`project_id` text PRIMARY KEY NOT NULL,
	`consent_mode` text DEFAULT 'required' NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`reporting_currency` text DEFAULT 'USD' NOT NULL,
	`lookback_days` integer DEFAULT 90 NOT NULL,
	`retention_days` integer DEFAULT 395 NOT NULL,
	`daily_event_limit` integer DEFAULT 200000 NOT NULL,
	`default_model` text DEFAULT 'last_non_direct' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `attribution_conversions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`event_id` text NOT NULL,
	`kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`occurred_at` text NOT NULL,
	`brand_id` text,
	`property_id` text,
	`amount_minor` integer,
	`gross_minor` integer,
	`currency` text,
	`is_first_payment` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `attribution_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attribution_conversions_event_idx` ON `attribution_conversions` (`event_id`);--> statement-breakpoint
CREATE INDEX `attribution_conversions_kind_idx` ON `attribution_conversions` (`project_id`,`kind`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `attribution_conversions_subject_idx` ON `attribution_conversions` (`project_id`,`subject_id`);--> statement-breakpoint
CREATE TABLE `attribution_credits` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`conversion_id` text NOT NULL,
	`model_key` text NOT NULL,
	`run_id` text NOT NULL,
	`touchpoint_id` text,
	`channel` text NOT NULL,
	`source` text,
	`credit_bp` integer NOT NULL,
	`evidence` text NOT NULL,
	`conversion_kind` text NOT NULL,
	`occurred_at` text NOT NULL,
	`brand_id` text,
	`amount_minor` integer,
	`currency` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversion_id`) REFERENCES `attribution_conversions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attribution_credits_model_idx` ON `attribution_credits` (`project_id`,`model_key`,`conversion_kind`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `attribution_credits_conversion_idx` ON `attribution_credits` (`conversion_id`,`model_key`);--> statement-breakpoint
CREATE TABLE `attribution_identity_links` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`a_type` text NOT NULL,
	`a_value` text NOT NULL,
	`b_type` text NOT NULL,
	`b_value` text NOT NULL,
	`status` text NOT NULL,
	`evidence_event_id` text NOT NULL,
	`reason` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`evidence_event_id`) REFERENCES `attribution_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attribution_links_pair_idx` ON `attribution_identity_links` (`project_id`,`a_type`,`a_value`,`b_type`,`b_value`);--> statement-breakpoint
CREATE INDEX `attribution_links_a_idx` ON `attribution_identity_links` (`project_id`,`a_type`,`a_value`);--> statement-breakpoint
CREATE INDEX `attribution_links_b_idx` ON `attribution_identity_links` (`project_id`,`b_type`,`b_value`);--> statement-breakpoint
CREATE TABLE `attribution_identity_nodes` (
	`project_id` text NOT NULL,
	`node_type` text NOT NULL,
	`node_value` text NOT NULL,
	`subject_id` text NOT NULL,
	`first_seen_at` text NOT NULL,
	PRIMARY KEY(`project_id`, `node_type`, `node_value`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attribution_nodes_subject_idx` ON `attribution_identity_nodes` (`project_id`,`subject_id`);--> statement-breakpoint
CREATE TABLE `attribution_ingest_counters` (
	`project_id` text NOT NULL,
	`day` text NOT NULL,
	`accepted` integer DEFAULT 0 NOT NULL,
	`rejected` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`project_id`, `day`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `attribution_model_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`model_version` text NOT NULL,
	`lookback_days` integer NOT NULL,
	`parameters` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attribution_runs_project_idx` ON `attribution_model_runs` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `attribution_pending` (
	`event_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`position` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `attribution_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attribution_pending_queue_idx` ON `attribution_pending` (`project_id`,`position`);--> statement-breakpoint
CREATE TABLE `attribution_source_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`match_kind` text NOT NULL,
	`pattern` text NOT NULL,
	`channel` text NOT NULL,
	`source_label` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attribution_rules_match_idx` ON `attribution_source_rules` (`project_id`,`match_kind`,`pattern`);--> statement-breakpoint
CREATE TABLE `attribution_touchpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`event_id` text NOT NULL,
	`kind` text NOT NULL,
	`anchor_type` text NOT NULL,
	`anchor_value` text NOT NULL,
	`session_id` text,
	`property_id` text,
	`brand_id` text,
	`occurred_at` text NOT NULL,
	`channel` text NOT NULL,
	`source` text,
	`rule_id` text NOT NULL,
	`landing_host` text,
	`landing_path` text,
	`referrer_host` text,
	`utm_campaign` text,
	`self_reported_text` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `attribution_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attribution_touchpoints_anchor_idx` ON `attribution_touchpoints` (`project_id`,`anchor_type`,`anchor_value`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `attribution_touchpoints_time_idx` ON `attribution_touchpoints` (`project_id`,`channel`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `attribution_touchpoints_event_idx` ON `attribution_touchpoints` (`event_id`);