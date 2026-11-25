CREATE TABLE "coding_agent_panels" (
	"project_id" text NOT NULL,
	"id" text NOT NULL,
	"mode" text NOT NULL,
	"prompt" text NOT NULL,
	"model" text NOT NULL,
	"captured_at" text NOT NULL,
	CONSTRAINT "coding_agent_panels_project_id_id_pk" PRIMARY KEY("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "coding_agent_runs" (
	"project_id" text NOT NULL,
	"panel_id" text NOT NULL,
	"slot" integer NOT NULL,
	"answer" text NOT NULL,
	"query" text,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"list_rate_micro_usd" integer NOT NULL,
	"lookup_cost_micro_usd" integer,
	CONSTRAINT "coding_agent_runs_project_id_panel_id_slot_pk" PRIMARY KEY("project_id","panel_id","slot")
);
--> statement-breakpoint
CREATE TABLE "coding_agent_sources" (
	"project_id" text NOT NULL,
	"panel_id" text NOT NULL,
	"slot" integer NOT NULL,
	"url" text NOT NULL,
	"evidence" text NOT NULL,
	CONSTRAINT "coding_agent_sources_project_id_panel_id_slot_url_evidence_pk" PRIMARY KEY("project_id","panel_id","slot","url","evidence")
);
--> statement-breakpoint
ALTER TABLE "coding_agent_panels" ADD CONSTRAINT "coding_agent_panels_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coding_agent_runs" ADD CONSTRAINT "coding_agent_runs_project_id_panel_id_coding_agent_panels_project_id_id_fk" FOREIGN KEY ("project_id","panel_id") REFERENCES "public"."coding_agent_panels"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coding_agent_sources" ADD CONSTRAINT "coding_agent_sources_project_id_panel_id_slot_coding_agent_runs_project_id_panel_id_slot_fk" FOREIGN KEY ("project_id","panel_id","slot") REFERENCES "public"."coding_agent_runs"("project_id","panel_id","slot") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coding_agent_panels_project_capture_idx" ON "coding_agent_panels" USING btree ("project_id","captured_at");