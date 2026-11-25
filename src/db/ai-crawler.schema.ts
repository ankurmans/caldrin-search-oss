import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { projects } from "./app.schema";

// The key a customer's Worker snippet sends with each AI bot visit. Only the
// hash is stored; the key is shown once when it is created or rotated.
export const aiCrawlerKeys = sqliteTable(
  "ai_crawler_keys",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    keyHash: text("key_hash").notNull(),
    // The first characters of the key, so a person can tell which one is installed.
    prefix: text("prefix").notNull(),
    createdAt: text("created_at").notNull(),
    lastUsedAt: text("last_used_at"),
  },
  (t) => [
    uniqueIndex("ai_crawler_keys_project_idx").on(t.projectId),
    uniqueIndex("ai_crawler_keys_hash_idx").on(t.keyHash),
  ],
);

// Visits that a user agent claimed to be an AI crawler, counted per day, bot,
// path and status class. The claim is not verified against the operator's IP
// ranges. Counts, not raw requests, so the table stays small.
export const aiCrawlerHits = sqliteTable(
  "ai_crawler_hits",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    bot: text("bot").notNull(),
    path: text("path").notNull(),
    // 2, 3, 4 or 5: the first digit of the response status.
    statusClass: integer("status_class").notNull(),
    hits: integer("hits").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.projectId, t.day, t.bot, t.path, t.statusClass],
    }),
    index("ai_crawler_hits_day_idx").on(t.projectId, t.day),
  ],
);

// A read-only Cloudflare API token for the project's zone, so visits come from
// Cloudflare's own analytics instead of a Worker the customer installs. The
// token is stored sealed and never returned to the browser.
export const aiCrawlerCloudflare = sqliteTable("ai_crawler_cloudflare", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  sealedToken: text("sealed_token").notNull(),
  zoneId: text("zone_id").notNull(),
  zoneName: text("zone_name").notNull(),
  createdAt: text("created_at").notNull(),
  lastSyncedAt: text("last_synced_at"),
  // The last failure from Cloudflare, shown to the person; null when the last sync worked.
  lastError: text("last_error"),
});
