CREATE TABLE "competitor_dismissals" (
	"project_id" text NOT NULL,
	"domain" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "competitor_dismissals_project_id_domain_pk" PRIMARY KEY("project_id","domain")
);
--> statement-breakpoint
ALTER TABLE "competitor_dismissals" ADD CONSTRAINT "competitor_dismissals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;