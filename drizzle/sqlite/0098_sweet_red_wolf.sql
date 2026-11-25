CREATE TABLE `workspace_branding` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`brand_name` text NOT NULL,
	`logo_url` text,
	`accent_color` text,
	`hide_attribution` integer NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
