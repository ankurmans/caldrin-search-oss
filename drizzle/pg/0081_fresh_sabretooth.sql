CREATE TABLE "ai_observation_products" (
	"id" text PRIMARY KEY NOT NULL,
	"observation_id" text NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"price" real,
	"currency" text,
	"tag" text,
	"provider_field" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_observation_products" ADD CONSTRAINT "ai_observation_products_observation_id_ai_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."ai_observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_observation_products_observation_idx" ON "ai_observation_products" USING btree ("observation_id");