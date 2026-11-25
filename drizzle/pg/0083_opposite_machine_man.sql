CREATE TABLE "ai_perception_experiment_prompts" (
	"experiment_id" text NOT NULL,
	"prompt_id" text NOT NULL,
	CONSTRAINT "ai_perception_experiment_prompts_experiment_id_prompt_id_pk" PRIMARY KEY("experiment_id","prompt_id")
);
--> statement-breakpoint
CREATE TABLE "ai_perception_experiment_replays" (
	"id" text PRIMARY KEY NOT NULL,
	"experiment_id" text NOT NULL,
	"prompt_id" text NOT NULL,
	"arm" text NOT NULL,
	"repeat" integer NOT NULL,
	"answer_markdown" text NOT NULL,
	"named" boolean NOT NULL,
	"stance" text,
	"sentiment" text,
	"evidence" text,
	"cost_usd" real NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_perception_experiments" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"title" text NOT NULL,
	"source_url" text,
	"original_text" text NOT NULL,
	"edited_text" text NOT NULL,
	"assumptions" text NOT NULL,
	"repeats" integer NOT NULL,
	"status" text NOT NULL,
	"brand_name" text NOT NULL,
	"brand_domain" text NOT NULL,
	"model" text,
	"opportunity_id" text,
	"cost_usd" real NOT NULL,
	"created_by" text,
	"created_at" text NOT NULL,
	"replayed_at" text,
	"approved_at" text
);
--> statement-breakpoint
ALTER TABLE "ai_perception_experiment_prompts" ADD CONSTRAINT "ai_perception_experiment_prompts_experiment_id_ai_perception_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."ai_perception_experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_perception_experiment_prompts" ADD CONSTRAINT "ai_perception_experiment_prompts_prompt_id_ai_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."ai_prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_perception_experiment_replays" ADD CONSTRAINT "ai_perception_experiment_replays_experiment_id_ai_perception_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."ai_perception_experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_perception_experiment_replays" ADD CONSTRAINT "ai_perception_experiment_replays_prompt_id_ai_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."ai_prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_perception_experiments" ADD CONSTRAINT "ai_perception_experiments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_perception_experiment_replays_slot_idx" ON "ai_perception_experiment_replays" USING btree ("experiment_id","prompt_id","arm","repeat");--> statement-breakpoint
CREATE INDEX "ai_perception_experiments_project_idx" ON "ai_perception_experiments" USING btree ("project_id");