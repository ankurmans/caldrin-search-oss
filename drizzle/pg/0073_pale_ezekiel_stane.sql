CREATE TABLE "ai_prompt_volumes" (
	"prompt_id" text NOT NULL,
	"location_code" integer NOT NULL,
	"language_code" text NOT NULL,
	"volume" integer,
	"fetched_at" text NOT NULL,
	CONSTRAINT "ai_prompt_volumes_prompt_id_location_code_language_code_pk" PRIMARY KEY("prompt_id","location_code","language_code")
);
--> statement-breakpoint
ALTER TABLE "ai_prompt_volumes" ADD CONSTRAINT "ai_prompt_volumes_prompt_id_ai_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."ai_prompts"("id") ON DELETE cascade ON UPDATE no action;