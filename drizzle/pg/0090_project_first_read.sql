CREATE TABLE "project_first_read_findings" (
	"read_key" text NOT NULL,
	"rank" integer NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"metric" double precision NOT NULL,
	"related_metric" double precision,
	"page" text,
	"observed_at" text NOT NULL,
	"range_start" text,
	"range_end" text,
	CONSTRAINT "project_first_read_findings_read_key_rank_pk" PRIMARY KEY("read_key","rank")
);
--> statement-breakpoint
CREATE TABLE "project_first_reads" (
	"key" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"completed_at" text NOT NULL,
	"search_console" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_first_read_findings" ADD CONSTRAINT "project_first_read_findings_read_key_project_first_reads_key_fk" FOREIGN KEY ("read_key") REFERENCES "public"."project_first_reads"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_first_reads" ADD CONSTRAINT "project_first_reads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_first_reads_project_idx" ON "project_first_reads" USING btree ("project_id");