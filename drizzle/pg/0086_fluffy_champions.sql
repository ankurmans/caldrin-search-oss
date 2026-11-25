CREATE TABLE "attribution_brands" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attribution_event_identifiers" (
	"event_id" text NOT NULL,
	"project_id" text NOT NULL,
	"identifier_type" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "attribution_event_identifiers_event_id_identifier_type_pk" PRIMARY KEY("event_id","identifier_type")
);
--> statement-breakpoint
CREATE TABLE "attribution_events" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"property_id" text,
	"brand_id" text,
	"intended_brand_id" text,
	"event_type" text NOT NULL,
	"source_system" text NOT NULL,
	"source_event_id" text NOT NULL,
	"origin" text NOT NULL,
	"occurred_at" text NOT NULL,
	"ingested_at" text NOT NULL,
	"import_batch_id" text,
	"session_id" text,
	"landing_host" text,
	"landing_path" text,
	"page_path" text,
	"referrer_host" text,
	"referrer_path" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_term" text,
	"utm_content" text,
	"click_id_kind" text,
	"click_id" text,
	"self_reported_source" text,
	"stage" text,
	"amount_minor" bigint,
	"currency" text,
	"parent_source_event_id" text,
	"payload" text,
	"payload_key" text,
	"is_test" boolean DEFAULT false NOT NULL,
	"is_bot" boolean DEFAULT false NOT NULL,
	"consent" text DEFAULT 'granted' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attribution_import_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"source_system" text NOT NULL,
	"label" text NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"received_count" integer DEFAULT 0 NOT NULL,
	"accepted_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attribution_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"key_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"public_value" text,
	"created_at" text NOT NULL,
	"last_used_at" text,
	"revoked_at" text
);
--> statement-breakpoint
CREATE TABLE "attribution_properties" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"brand_id" text,
	"name" text NOT NULL,
	"host" text NOT NULL,
	"created_at" text NOT NULL,
	"verified_at" text,
	"last_event_at" text
);
--> statement-breakpoint
CREATE TABLE "attribution_rejections" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"import_batch_id" text,
	"source_system" text NOT NULL,
	"reason" text NOT NULL,
	"detail" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attribution_settings" (
	"project_id" text PRIMARY KEY NOT NULL,
	"consent_mode" text DEFAULT 'required' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"reporting_currency" text DEFAULT 'USD' NOT NULL,
	"lookback_days" integer DEFAULT 90 NOT NULL,
	"retention_days" integer DEFAULT 395 NOT NULL,
	"daily_event_limit" integer DEFAULT 200000 NOT NULL,
	"default_model" text DEFAULT 'last_non_direct' NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attribution_conversions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"event_id" text NOT NULL,
	"kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"occurred_at" text NOT NULL,
	"brand_id" text,
	"property_id" text,
	"amount_minor" bigint,
	"gross_minor" bigint,
	"currency" text,
	"is_first_payment" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attribution_credits" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"conversion_id" text NOT NULL,
	"model_key" text NOT NULL,
	"run_id" text NOT NULL,
	"touchpoint_id" text,
	"channel" text NOT NULL,
	"source" text,
	"credit_bp" integer NOT NULL,
	"evidence" text NOT NULL,
	"conversion_kind" text NOT NULL,
	"occurred_at" text NOT NULL,
	"brand_id" text,
	"amount_minor" bigint,
	"currency" text
);
--> statement-breakpoint
CREATE TABLE "attribution_identity_links" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"a_type" text NOT NULL,
	"a_value" text NOT NULL,
	"b_type" text NOT NULL,
	"b_value" text NOT NULL,
	"status" text NOT NULL,
	"evidence_event_id" text NOT NULL,
	"reason" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attribution_identity_nodes" (
	"project_id" text NOT NULL,
	"node_type" text NOT NULL,
	"node_value" text NOT NULL,
	"subject_id" text NOT NULL,
	"first_seen_at" text NOT NULL,
	CONSTRAINT "attribution_identity_nodes_project_id_node_type_node_value_pk" PRIMARY KEY("project_id","node_type","node_value")
);
--> statement-breakpoint
CREATE TABLE "attribution_ingest_counters" (
	"project_id" text NOT NULL,
	"day" text NOT NULL,
	"accepted" integer DEFAULT 0 NOT NULL,
	"rejected" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "attribution_ingest_counters_project_id_day_pk" PRIMARY KEY("project_id","day")
);
--> statement-breakpoint
CREATE TABLE "attribution_model_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"model_version" text NOT NULL,
	"lookback_days" integer NOT NULL,
	"parameters" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "attribution_pending" (
	"event_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"position" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attribution_source_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"match_kind" text NOT NULL,
	"pattern" text NOT NULL,
	"channel" text NOT NULL,
	"source_label" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attribution_touchpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"event_id" text NOT NULL,
	"kind" text NOT NULL,
	"anchor_type" text NOT NULL,
	"anchor_value" text NOT NULL,
	"session_id" text,
	"property_id" text,
	"brand_id" text,
	"occurred_at" text NOT NULL,
	"channel" text NOT NULL,
	"source" text,
	"rule_id" text NOT NULL,
	"landing_host" text,
	"landing_path" text,
	"referrer_host" text,
	"utm_campaign" text,
	"self_reported_text" text
);
--> statement-breakpoint
ALTER TABLE "attribution_brands" ADD CONSTRAINT "attribution_brands_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_event_identifiers" ADD CONSTRAINT "attribution_event_identifiers_event_id_attribution_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."attribution_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_event_identifiers" ADD CONSTRAINT "attribution_event_identifiers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_events" ADD CONSTRAINT "attribution_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_events" ADD CONSTRAINT "attribution_events_property_id_attribution_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."attribution_properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_events" ADD CONSTRAINT "attribution_events_brand_id_attribution_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."attribution_brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_events" ADD CONSTRAINT "attribution_events_intended_brand_id_attribution_brands_id_fk" FOREIGN KEY ("intended_brand_id") REFERENCES "public"."attribution_brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_events" ADD CONSTRAINT "attribution_events_import_batch_id_attribution_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."attribution_import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_import_batches" ADD CONSTRAINT "attribution_import_batches_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_keys" ADD CONSTRAINT "attribution_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_properties" ADD CONSTRAINT "attribution_properties_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_properties" ADD CONSTRAINT "attribution_properties_brand_id_attribution_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."attribution_brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_rejections" ADD CONSTRAINT "attribution_rejections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_rejections" ADD CONSTRAINT "attribution_rejections_import_batch_id_attribution_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."attribution_import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_settings" ADD CONSTRAINT "attribution_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_conversions" ADD CONSTRAINT "attribution_conversions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_conversions" ADD CONSTRAINT "attribution_conversions_event_id_attribution_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."attribution_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_credits" ADD CONSTRAINT "attribution_credits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_credits" ADD CONSTRAINT "attribution_credits_conversion_id_attribution_conversions_id_fk" FOREIGN KEY ("conversion_id") REFERENCES "public"."attribution_conversions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_identity_links" ADD CONSTRAINT "attribution_identity_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_identity_links" ADD CONSTRAINT "attribution_identity_links_evidence_event_id_attribution_events_id_fk" FOREIGN KEY ("evidence_event_id") REFERENCES "public"."attribution_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_identity_nodes" ADD CONSTRAINT "attribution_identity_nodes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_ingest_counters" ADD CONSTRAINT "attribution_ingest_counters_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_model_runs" ADD CONSTRAINT "attribution_model_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_pending" ADD CONSTRAINT "attribution_pending_event_id_attribution_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."attribution_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_pending" ADD CONSTRAINT "attribution_pending_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_source_rules" ADD CONSTRAINT "attribution_source_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_touchpoints" ADD CONSTRAINT "attribution_touchpoints_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_touchpoints" ADD CONSTRAINT "attribution_touchpoints_event_id_attribution_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."attribution_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attribution_brands_slug_idx" ON "attribution_brands" USING btree ("project_id","slug");--> statement-breakpoint
CREATE INDEX "attribution_identifiers_value_idx" ON "attribution_event_identifiers" USING btree ("project_id","identifier_type","value");--> statement-breakpoint
CREATE UNIQUE INDEX "attribution_events_source_idx" ON "attribution_events" USING btree ("project_id","source_system","source_event_id");--> statement-breakpoint
CREATE INDEX "attribution_events_time_idx" ON "attribution_events" USING btree ("project_id","event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "attribution_events_batch_idx" ON "attribution_events" USING btree ("import_batch_id");--> statement-breakpoint
CREATE INDEX "attribution_events_parent_idx" ON "attribution_events" USING btree ("project_id","parent_source_event_id");--> statement-breakpoint
CREATE INDEX "attribution_batches_project_idx" ON "attribution_import_batches" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "attribution_keys_hash_idx" ON "attribution_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "attribution_keys_project_idx" ON "attribution_keys" USING btree ("project_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "attribution_properties_host_idx" ON "attribution_properties" USING btree ("project_id","host");--> statement-breakpoint
CREATE INDEX "attribution_rejections_project_idx" ON "attribution_rejections" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "attribution_conversions_event_idx" ON "attribution_conversions" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "attribution_conversions_kind_idx" ON "attribution_conversions" USING btree ("project_id","kind","occurred_at");--> statement-breakpoint
CREATE INDEX "attribution_conversions_subject_idx" ON "attribution_conversions" USING btree ("project_id","subject_id");--> statement-breakpoint
CREATE INDEX "attribution_credits_model_idx" ON "attribution_credits" USING btree ("project_id","model_key","conversion_kind","occurred_at");--> statement-breakpoint
CREATE INDEX "attribution_credits_conversion_idx" ON "attribution_credits" USING btree ("conversion_id","model_key");--> statement-breakpoint
CREATE UNIQUE INDEX "attribution_links_pair_idx" ON "attribution_identity_links" USING btree ("project_id","a_type","a_value","b_type","b_value");--> statement-breakpoint
CREATE INDEX "attribution_links_a_idx" ON "attribution_identity_links" USING btree ("project_id","a_type","a_value");--> statement-breakpoint
CREATE INDEX "attribution_links_b_idx" ON "attribution_identity_links" USING btree ("project_id","b_type","b_value");--> statement-breakpoint
CREATE INDEX "attribution_nodes_subject_idx" ON "attribution_identity_nodes" USING btree ("project_id","subject_id");--> statement-breakpoint
CREATE INDEX "attribution_runs_project_idx" ON "attribution_model_runs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "attribution_pending_queue_idx" ON "attribution_pending" USING btree ("project_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "attribution_rules_match_idx" ON "attribution_source_rules" USING btree ("project_id","match_kind","pattern");--> statement-breakpoint
CREATE INDEX "attribution_touchpoints_anchor_idx" ON "attribution_touchpoints" USING btree ("project_id","anchor_type","anchor_value","occurred_at");--> statement-breakpoint
CREATE INDEX "attribution_touchpoints_time_idx" ON "attribution_touchpoints" USING btree ("project_id","channel","occurred_at");--> statement-breakpoint
CREATE INDEX "attribution_touchpoints_event_idx" ON "attribution_touchpoints" USING btree ("event_id");