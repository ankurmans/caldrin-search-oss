ALTER TABLE "wallet_order" ADD COLUMN "period_start" text;--> statement-breakpoint
ALTER TABLE "wallet_order" ADD COLUMN "period_end" text;--> statement-breakpoint
ALTER TABLE "wallet_run" ADD COLUMN "included_order_id" text;--> statement-breakpoint
ALTER TABLE "wallet_run" ADD COLUMN "included_reserved" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "wallet_run" ADD COLUMN "included_charged" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "wallet_run" ADD CONSTRAINT "wallet_run_included_order_id_wallet_order_id_fk" FOREIGN KEY ("included_order_id") REFERENCES "public"."wallet_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wallet_run_included_order_idx" ON "wallet_run" USING btree ("included_order_id");