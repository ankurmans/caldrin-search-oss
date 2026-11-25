import { index, boolean, pgTable, text } from "drizzle-orm/pg-core";
import { organization } from "./better-auth-schema";
import type { PlatformPlan } from "@/shared/wallet-pricing";

export const platformSubscription = pgTable(
  "platform_subscription",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    plan: text("plan").$type<PlatformPlan>().notNull(),
    active: boolean("active").notNull(),
    eventAt: text("event_at").notNull(),
    renewsAt: text("renews_at"),
  },
  (table) => [index("platform_subscription_org_idx").on(table.organizationId)],
);

export const platformGrace = pgTable("platform_grace", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  teams: boolean("teams").notNull(),
  branding: boolean("branding").notNull(),
  expiresAt: text("expires_at").notNull(),
});
