CREATE TABLE "market_report_schedule_markets" (
	"schedule_id" text NOT NULL,
	"location_code" integer NOT NULL,
	"language_code" text NOT NULL,
	CONSTRAINT "market_report_schedule_markets_schedule_id_location_code_language_code_pk" PRIMARY KEY("schedule_id","location_code","language_code")
);
--> statement-breakpoint
CREATE TABLE "market_report_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"cadence" integer NOT NULL,
	"days" integer NOT NULL,
	"next_run_at" text NOT NULL,
	"last_status" text,
	"last_report_id" text
);
--> statement-breakpoint
ALTER TABLE "market_report_schedule_markets" ADD CONSTRAINT "market_report_schedule_markets_schedule_id_market_report_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."market_report_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_report_schedules" ADD CONSTRAINT "market_report_schedules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "market_report_schedule_project_user" ON "market_report_schedules" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "market_report_next_run" ON "market_report_schedules" USING btree ("next_run_at");