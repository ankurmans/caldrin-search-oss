import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  contentAssets,
  contentOpportunities,
  contentProviderCosts,
  contentPublications,
} from "@/db/schema";

export type ContentPublication = typeof contentPublications.$inferSelect;

async function findPublication(
  idempotencyKey: string,
): Promise<ContentPublication | null> {
  const rows = await db
    .select()
    .from(contentPublications)
    .where(eq(contentPublications.idempotencyKey, idempotencyKey))
    .limit(1);
  return rows[0] ?? null;
}

// Returns null when another request already claimed this key.
async function claimPublication(input: {
  assetId: string;
  revision: number;
  mode: "live" | "simulated";
  idempotencyKey: string;
  requestedByUserId: string;
}): Promise<ContentPublication | null> {
  const rows = await db
    .insert(contentPublications)
    .values({
      id: crypto.randomUUID(),
      connector: "shopify",
      state: "pending",
      ...input,
    })
    .onConflictDoNothing({ target: contentPublications.idempotencyKey })
    .returning();
  return rows[0] ?? null;
}

async function updatePublication(
  id: string,
  fields: Partial<
    Pick<
      ContentPublication,
      "state" | "externalId" | "externalUrl" | "error" | "publishedAt"
    >
  >,
): Promise<void> {
  await db
    .update(contentPublications)
    .set({ ...fields, updatedAt: sql`(current_timestamp)` })
    .where(eq(contentPublications.id, id));
}

async function listPublications(
  assetId: string,
): Promise<ContentPublication[]> {
  return db
    .select()
    .from(contentPublications)
    .where(eq(contentPublications.assetId, assetId))
    .orderBy(desc(contentPublications.createdAt));
}

async function logCost(input: {
  projectId: string;
  assetId: string | null;
  provider: string;
  operation: string;
  costUsd: number;
}): Promise<void> {
  await db
    .insert(contentProviderCosts)
    .values({ id: crypto.randomUUID(), ...input });
}

async function sumCostUsd(projectId: string): Promise<number> {
  const rows = await db
    .select({
      total: sql<number>`coalesce(sum(${contentProviderCosts.costUsd}), 0)`,
    })
    .from(contentProviderCosts)
    .where(eq(contentProviderCosts.projectId, projectId));
  return Number(rows[0]?.total ?? 0);
}

// Published articles of one project with the opportunity they came from.
async function listPublishedArticles(projectId: string) {
  return db
    .select({
      assetId: contentAssets.id,
      title: contentAssets.title,
      revision: contentPublications.revision,
      mode: contentPublications.mode,
      url: contentPublications.externalUrl,
      publishedAt: contentPublications.publishedAt,
      query: contentOpportunities.query,
    })
    .from(contentPublications)
    .innerJoin(contentAssets, eq(contentAssets.id, contentPublications.assetId))
    .leftJoin(
      contentOpportunities,
      eq(contentOpportunities.id, contentAssets.opportunityId),
    )
    .where(
      and(
        eq(contentAssets.projectId, projectId),
        eq(contentPublications.state, "published"),
      ),
    )
    .orderBy(desc(contentPublications.publishedAt));
}

async function countCostsSince(
  projectId: string,
  operation: string,
  sinceDate: string,
): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(contentProviderCosts)
    .where(
      and(
        eq(contentProviderCosts.projectId, projectId),
        eq(contentProviderCosts.operation, operation),
        gte(contentProviderCosts.createdAt, sinceDate),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

export const PublicationRepository = {
  findPublication,
  claimPublication,
  updatePublication,
  listPublications,
  logCost,
  sumCostUsd,
  countCostsSince,
  listPublishedArticles,
};
