CREATE TABLE "wallet_refill_checkout" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"attempt" text NOT NULL,
	"amount_usd" integer NOT NULL,
	"expires_at" text NOT NULL,
	"checkout_url" text
);
--> statement-breakpoint
CREATE TABLE "wallet_refill_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"amount_usd" integer NOT NULL,
	"status" text NOT NULL,
	"ends_after_period" boolean NOT NULL,
	"period_end" text,
	"event_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wallet_refill_checkout" ADD CONSTRAINT "wallet_refill_checkout_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_refill_subscription" ADD CONSTRAINT "wallet_refill_subscription_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wallet_refill_subscription_org_idx" ON "wallet_refill_subscription" USING btree ("organization_id");