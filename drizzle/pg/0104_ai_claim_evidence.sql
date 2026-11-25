CREATE TABLE "ai_claim_source_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"occurrence_id" text NOT NULL,
	"snapshot_id" text NOT NULL,
	"relation" text NOT NULL,
	"relevance" text NOT NULL,
	"rationale" text NOT NULL,
	"reviewer_id" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_claim_extractions" ADD COLUMN "resolved_model" text;--> statement-breakpoint
ALTER TABLE "ai_claim_source_snapshots" ADD COLUMN "matching_passage" text;--> statement-breakpoint
ALTER TABLE "ai_claim_source_reviews" ADD CONSTRAINT "ai_claim_source_reviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_claim_source_reviews" ADD CONSTRAINT "ai_claim_source_reviews_occurrence_id_ai_claim_occurrences_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."ai_claim_occurrences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_claim_source_reviews" ADD CONSTRAINT "ai_claim_source_reviews_snapshot_id_ai_claim_source_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."ai_claim_source_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_claim_source_reviews_occurrence" ON "ai_claim_source_reviews" USING btree ("project_id","occurrence_id","created_at");