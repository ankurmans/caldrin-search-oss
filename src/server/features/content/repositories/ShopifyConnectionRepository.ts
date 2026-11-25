import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { shopifyConnections } from "@/db/schema";

export type ShopifyConnection = typeof shopifyConnections.$inferSelect;

async function getConnection(
  projectId: string,
): Promise<ShopifyConnection | null> {
  const rows = await db
    .select()
    .from(shopifyConnections)
    .where(eq(shopifyConnections.projectId, projectId))
    .limit(1);
  return rows[0] ?? null;
}

async function upsertConnection(input: {
  projectId: string;
  organizationId: string;
  shopDomain: string;
  mode: "live" | "simulated";
  isDevelopmentStore?: boolean;
  sealedAccessToken: string | null;
  sealedRefreshToken?: string | null;
  accessTokenExpiresAt?: string | null;
  refreshTokenExpiresAt?: string | null;
  grantedScopes: string;
  canPublish: boolean;
  apiVersion: string;
  connectedByUserId: string;
}): Promise<ShopifyConnection> {
  const [row] = await db
    .insert(shopifyConnections)
    .values({ id: crypto.randomUUID(), ...input })
    .onConflictDoUpdate({
      target: shopifyConnections.projectId,
      set: {
        organizationId: input.organizationId,
        shopDomain: input.shopDomain,
        mode: input.mode,
        isDevelopmentStore: input.isDevelopmentStore ?? false,
        sealedAccessToken: input.sealedAccessToken,
        sealedRefreshToken: input.sealedRefreshToken ?? null,
        accessTokenExpiresAt: input.accessTokenExpiresAt ?? null,
        refreshTokenExpiresAt: input.refreshTokenExpiresAt ?? null,
        grantedScopes: input.grantedScopes,
        canPublish: input.canPublish,
        apiVersion: input.apiVersion,
        connectedByUserId: input.connectedByUserId,
        updatedAt: sql`(current_timestamp)`,
      },
    })
    .returning();
  if (!row) throw new Error("Failed to upsert shopify_connection");
  return row;
}

async function updateTokens(
  projectId: string,
  tokens: {
    sealedAccessToken: string;
    sealedRefreshToken: string | null;
    accessTokenExpiresAt: string | null;
    refreshTokenExpiresAt: string | null;
  },
): Promise<void> {
  await db
    .update(shopifyConnections)
    .set({ ...tokens, updatedAt: sql`(current_timestamp)` })
    .where(eq(shopifyConnections.projectId, projectId));
}

async function setBlog(projectId: string, blogId: string | null) {
  await db
    .update(shopifyConnections)
    .set({ blogId, updatedAt: sql`(current_timestamp)` })
    .where(eq(shopifyConnections.projectId, projectId));
}

async function setAutoPublish(projectId: string, autoPublish: boolean) {
  await db
    .update(shopifyConnections)
    .set({ autoPublish, updatedAt: sql`(current_timestamp)` })
    .where(eq(shopifyConnections.projectId, projectId));
}

async function deleteConnection(projectId: string): Promise<void> {
  await db
    .delete(shopifyConnections)
    .where(eq(shopifyConnections.projectId, projectId));
}

async function deleteLiveConnectionsForShop(
  shopDomain: string,
): Promise<number> {
  const rows = await db
    .delete(shopifyConnections)
    .where(
      and(
        eq(shopifyConnections.shopDomain, shopDomain),
        eq(shopifyConnections.mode, "live"),
      ),
    )
    .returning({ id: shopifyConnections.id });
  return rows.length;
}

export const ShopifyConnectionRepository = {
  getConnection,
  upsertConnection,
  updateTokens,
  setBlog,
  setAutoPublish,
  deleteConnection,
  deleteLiveConnectionsForShop,
};
