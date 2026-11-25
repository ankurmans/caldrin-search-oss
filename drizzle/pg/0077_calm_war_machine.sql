ALTER TABLE "local_rank_trackers" ADD COLUMN "schedule_interval" text;--> statement-breakpoint
ALTER TABLE "local_rank_trackers" ADD COLUMN "next_check_at" text;--> statement-breakpoint
ALTER TABLE "local_rank_trackers" ADD COLUMN "last_skip_reason" text;--> statement-breakpoint
CREATE INDEX "local_rank_trackers_due_idx" ON "local_rank_trackers" USING btree ("next_check_at");