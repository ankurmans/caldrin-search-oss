import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { organization } from "./better-auth-schema";

export const walletAccount = sqliteTable("wallet_account", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
});

export const walletOrder = sqliteTable(
  "wallet_order",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => walletAccount.organizationId, { onDelete: "cascade" }),
    purchasedCredits: integer("purchased_credits").notNull(),
    refundedCredits: integer("refunded_credits").notNull(),
    eventAt: text("event_at").notNull(),
    periodStart: text("period_start"),
    periodEnd: text("period_end"),
  },
  (table) => [index("wallet_order_org_idx").on(table.organizationId)],
);

export const walletRun = sqliteTable(
  "wallet_run",
  {
    runId: text("run_id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => walletAccount.organizationId, { onDelete: "cascade" }),
    reserved: integer("reserved").notNull(),
    charged: integer("charged"),
    includedOrderId: text("included_order_id").references(() => walletOrder.id),
    includedReserved: integer("included_reserved").notNull().default(0),
    includedCharged: integer("included_charged").notNull().default(0),
    standardRate: integer("standard_rate").notNull(),
    claudeRate: integer("claude_rate").notNull(),
    perplexityRate: integer("perplexity_rate").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    index("wallet_run_org_idx").on(table.organizationId),
    index("wallet_run_included_order_idx").on(table.includedOrderId),
    index("wallet_run_expiry_idx").on(table.charged, table.expiresAt),
  ],
);

export const walletRefillSubscription = sqliteTable(
  "wallet_refill_subscription",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    amountUsd: integer("amount_usd").notNull(),
    status: text("status").notNull(),
    endsAfterPeriod: integer("ends_after_period", {
      mode: "boolean",
    }).notNull(),
    periodEnd: text("period_end"),
    eventAt: text("event_at").notNull(),
  },
  (table) => [
    index("wallet_refill_subscription_org_idx").on(table.organizationId),
  ],
);

export const walletRefillCheckout = sqliteTable("wallet_refill_checkout", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  attempt: text("attempt").notNull(),
  amountUsd: integer("amount_usd").notNull(),
  expiresAt: text("expires_at").notNull(),
  checkoutUrl: text("checkout_url"),
});
