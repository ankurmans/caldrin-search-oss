import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { organization } from "./better-auth-schema";
import type { PlatformPlan } from "@/shared/wallet-pricing";

export const platformSubscription = sqliteTable(
  "platform_subscription",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    plan: text("plan").$type<PlatformPlan>().notNull(),
    active: integer("active", { mode: "boolean" }).notNull(),
    eventAt: text("event_at").notNull(),
    renewsAt: text("renews_at"),
  },
  (table) => [index("platform_subscription_org_idx").on(table.organizationId)],
);

export const platformGrace = sqliteTable("platform_grace", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  teams: integer("teams", { mode: "boolean" }).notNull(),
  branding: integer("branding", { mode: "boolean" }).notNull(),
  expiresAt: text("expires_at").notNull(),
});
