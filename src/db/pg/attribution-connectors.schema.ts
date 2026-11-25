import { index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { projects } from "./app.schema";

// A revenue source the project connected: a Stripe webhook today. The id is
// public (it is in the webhook URL); the signing secret is sealed.
export const attributionConnectors = pgTable(
  "attribution_connectors",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    sealedSecret: text("sealed_secret").notNull(),
    createdAt: text("created_at").notNull(),
    lastEventAt: text("last_event_at"),
    // Deliveries refused for a bad signature or a malformed body.
    failedCount: integer("failed_count").notNull().default(0),
    lastFailureAt: text("last_failure_at"),
    lastFailure: text("last_failure"),
  },
  (t) => [index("attribution_connectors_project_idx").on(t.projectId, t.kind)],
);
