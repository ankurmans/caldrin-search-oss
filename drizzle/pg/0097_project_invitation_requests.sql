CREATE TABLE "project_invitation_request" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"requester_id" text NOT NULL,
	"email" text NOT NULL,
	"created_at" text NOT NULL,
	"status" text NOT NULL,
	"reviewed_at" text
);
--> statement-breakpoint
ALTER TABLE "project_invitation_request" ADD CONSTRAINT "project_invitation_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_invitation_request" ADD CONSTRAINT "project_invitation_request_requester_id_user_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_invite_request_email_idx" ON "project_invitation_request" USING btree ("organization_id","project_id","email");--> statement-breakpoint
CREATE INDEX "project_invite_request_status_idx" ON "project_invitation_request" USING btree ("organization_id","status");