CREATE TABLE "wallet_account" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_order" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"purchased_credits" integer NOT NULL,
	"refunded_credits" integer NOT NULL,
	"event_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_run" (
	"run_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"reserved" integer NOT NULL,
	"charged" integer,
	"standard_rate" integer NOT NULL,
	"claude_rate" integer NOT NULL,
	"perplexity_rate" integer NOT NULL,
	"created_at" text NOT NULL,
	"expires_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wallet_account" ADD CONSTRAINT "wallet_account_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_order" ADD CONSTRAINT "wallet_order_organization_id_wallet_account_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."wallet_account"("organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_run" ADD CONSTRAINT "wallet_run_organization_id_wallet_account_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."wallet_account"("organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wallet_order_org_idx" ON "wallet_order" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "wallet_run_org_idx" ON "wallet_run" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "wallet_run_expiry_idx" ON "wallet_run" USING btree ("charged","expires_at");