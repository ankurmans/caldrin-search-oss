import { boolean, pgTable, text } from "drizzle-orm/pg-core";
import { organization } from "./better-auth-schema";

// How a workspace's shared reports present themselves to readers outside the
// app: its own name, logo and accent in place of ours. One row per workspace.
export const workspaceBranding = pgTable("workspace_branding", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  brandName: text("brand_name").notNull(),
  // An https address the reader's browser loads; nothing is stored or proxied.
  logoUrl: text("logo_url"),
  // #rrggbb, used for the share page's primary button and accents.
  accentColor: text("accent_color"),
  // When on, the "Made with" line and the try-it button are not shown.
  hideAttribution: boolean("hide_attribution").notNull(),
  updatedAt: text("updated_at").notNull(),
});
