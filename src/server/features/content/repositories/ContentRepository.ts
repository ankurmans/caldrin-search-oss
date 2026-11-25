import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  contentAssetReferences,
  contentAssetVersions,
  contentAssets,
  contentOpportunities,
  contentQualityChecks,
  opportunityEvidence,
} from "@/db/schema";
import { PublicationRepository } from "./PublicationRepository";
import { ShopifyConnectionRepository } from "./ShopifyConnectionRepository";
import type { OpportunityDecision } from "../rules/opportunityRules";
import type { QualityCheck } from "../rules/qualityChecks";

// Every query is scoped by projectId. Callers pass the projectId that
// requireProjectContext resolved from the session, never one taken from input.

export type ContentOpportunity = typeof contentOpportunities.$inferSelect;
export type ContentAsset = typeof contentAssets.$inferSelect;

async function upsertOpportunities(input: {
  projectId: string;
  organizationId: string;
  decisions: OpportunityDecision[];
  dataSource: "gsc" | "simulated";
  windowStart: string;
  windowEnd: string;
}): Promise<void> {
  for (const d of input.decisions) {
    const fields = {
      impressions: d.impressions,
      clicks: d.clicks,
      ctr: d.ctr,
      position: d.position,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      recommendedAction: d.action,
      reason: d.reason,
      matchedCollectionHandle: d.matchedCollectionHandle,
      dataSource: input.dataSource,
    };
    await db
      .insert(contentOpportunities)
      .values({
        id: crypto.randomUUID(),
        projectId: input.projectId,
        organizationId: input.organizationId,
        dedupeKey: `${d.query.trim().toLowerCase()}|${d.pageUrl}`,
        query: d.query,
        pageUrl: d.pageUrl,
        ...fields,
      })
      .onConflictDoUpdate({
        target: [
          contentOpportunities.projectId,
          contentOpportunities.dedupeKey,
        ],
        set: { ...fields, updatedAt: sql`(current_timestamp)` },
      });
  }
}

async function listOpportunities(
  projectId: string,
): Promise<ContentOpportunity[]> {
  return db
    .select()
    .from(contentOpportunities)
    .where(eq(contentOpportunities.projectId, projectId))
    .orderBy(desc(contentOpportunities.impressions));
}

async function getOpportunity(
  projectId: string,
  id: string,
): Promise<ContentOpportunity | null> {
  const rows = await db
    .select()
    .from(contentOpportunities)
    .where(
      and(
        eq(contentOpportunities.projectId, projectId),
        eq(contentOpportunities.id, id),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function listOpportunityEvidence(
  projectId: string,
  opportunityId: string,
) {
  const rows = await db
    .select({ evidence: opportunityEvidence })
    .from(opportunityEvidence)
    .innerJoin(
      contentOpportunities,
      eq(contentOpportunities.id, opportunityEvidence.opportunityId),
    )
    .where(
      and(
        eq(contentOpportunities.projectId, projectId),
        eq(opportunityEvidence.opportunityId, opportunityId),
      ),
    );
  return rows.map((row) => row.evidence);
}

async function setOpportunityStatus(
  projectId: string,
  id: string,
  status: "open" | "briefed" | "dismissed",
): Promise<void> {
  await db
    .update(contentOpportunities)
    .set({ status, updatedAt: sql`(current_timestamp)` })
    .where(
      and(
        eq(contentOpportunities.projectId, projectId),
        eq(contentOpportunities.id, id),
      ),
    );
}

// Whether the opportunity engine stored evidence rows for this opportunity.
// Scoped through the opportunity's own project.
async function hasOpportunityEvidence(
  projectId: string,
  opportunityId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: opportunityEvidence.id })
    .from(opportunityEvidence)
    .innerJoin(
      contentOpportunities,
      eq(contentOpportunities.id, opportunityEvidence.opportunityId),
    )
    .where(
      and(
        eq(contentOpportunities.projectId, projectId),
        eq(opportunityEvidence.opportunityId, opportunityId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function recordVersion(
  asset: ContentAsset,
  userId: string | null,
): Promise<void> {
  await db
    .insert(contentAssetVersions)
    .values({
      id: crypto.randomUUID(),
      assetId: asset.id,
      revision: asset.revision,
      title: asset.title,
      bodyHtml: asset.bodyHtml,
      metaTitle: asset.metaTitle,
      metaDescription: asset.metaDescription,
      editedByUserId: userId,
    })
    .onConflictDoNothing();
}

async function createAsset(input: {
  id?: string;
  projectId: string;
  organizationId: string;
  opportunityId: string | null;
  title: string;
  searchIntent: string;
  briefMarkdown: string;
  bodyHtml: string;
  metaTitle: string;
  metaDescription: string;
  generator: "template" | "llm";
  importedFrom?: string;
  importWarning?: string;
  createdByUserId: string;
  references: {
    refType: "product" | "collection";
    handle: string;
    title: string;
    available: boolean;
  }[];
}): Promise<ContentAsset> {
  const { references, id = crypto.randomUUID(), ...assetFields } = input;
  const [asset] = await db
    .insert(contentAssets)
    .values({ id, ...assetFields })
    .returning();
  if (!asset) throw new Error("Failed to create content_asset");
  for (const ref of references) {
    await db
      .insert(contentAssetReferences)
      .values({ id: crypto.randomUUID(), assetId: asset.id, ...ref });
  }
  await recordVersion(asset, assetFields.createdByUserId);
  return asset;
}

async function getAsset(
  projectId: string,
  id: string,
): Promise<ContentAsset | null> {
  const rows = await db
    .select()
    .from(contentAssets)
    .where(
      and(eq(contentAssets.projectId, projectId), eq(contentAssets.id, id)),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function listAssets(projectId: string): Promise<ContentAsset[]> {
  return db
    .select()
    .from(contentAssets)
    .where(eq(contentAssets.projectId, projectId))
    .orderBy(desc(contentAssets.updatedAt));
}

// Editing bumps the revision and clears any approval, so an approval can only
// ever refer to the exact text a reviewer saw.
async function updateAssetContent(
  projectId: string,
  id: string,
  userId: string,
  fields: {
    title: string;
    bodyHtml: string;
    metaTitle: string;
    metaDescription: string;
  },
  expectedRevision?: number,
): Promise<ContentAsset | null> {
  const [row] = await db
    .update(contentAssets)
    .set({
      ...fields,
      revision: sql`${contentAssets.revision} + 1`,
      status: "draft",
      approvedByUserId: null,
      approvedRevision: null,
      approvedAt: null,
      updatedAt: sql`(current_timestamp)`,
    })
    .where(
      and(
        eq(contentAssets.projectId, projectId),
        eq(contentAssets.id, id),
        expectedRevision === undefined
          ? undefined
          : eq(contentAssets.revision, expectedRevision),
        ne(contentAssets.status, "published"),
      ),
    )
    .returning();
  if (row) await recordVersion(row, userId);
  return row ?? null;
}

async function listVersions(assetId: string) {
  return db
    .select()
    .from(contentAssetVersions)
    .where(eq(contentAssetVersions.assetId, assetId))
    .orderBy(desc(contentAssetVersions.revision));
}

async function approveAsset(
  projectId: string,
  id: string,
  revision: number,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .update(contentAssets)
    .set({
      status: "approved",
      approvedByUserId: userId,
      approvedRevision: revision,
      approvedAt: new Date().toISOString(),
      updatedAt: sql`(current_timestamp)`,
    })
    .where(
      and(
        eq(contentAssets.projectId, projectId),
        eq(contentAssets.id, id),
        eq(contentAssets.revision, revision),
      ),
    )
    .returning({ id: contentAssets.id });
  return rows.length === 1;
}

async function setAssetStatus(
  projectId: string,
  id: string,
  status: "draft" | "approved" | "published" | "failed",
): Promise<void> {
  await db
    .update(contentAssets)
    .set({ status, updatedAt: sql`(current_timestamp)` })
    .where(
      and(eq(contentAssets.projectId, projectId), eq(contentAssets.id, id)),
    );
}

async function listReferences(assetId: string) {
  return db
    .select()
    .from(contentAssetReferences)
    .where(eq(contentAssetReferences.assetId, assetId));
}

async function replaceQualityChecks(
  assetId: string,
  revision: number,
  checks: QualityCheck[],
): Promise<void> {
  await db
    .delete(contentQualityChecks)
    .where(
      and(
        eq(contentQualityChecks.assetId, assetId),
        eq(contentQualityChecks.revision, revision),
      ),
    );
  for (const check of checks) {
    await db.insert(contentQualityChecks).values({
      id: crypto.randomUUID(),
      assetId,
      revision,
      checkKey: check.key,
      severity: check.severity,
      passed: check.passed,
      detail: check.detail,
    });
  }
}

async function listQualityChecks(
  assetId: string,
  revision: number,
): Promise<QualityCheck[]> {
  const rows = await db
    .select()
    .from(contentQualityChecks)
    .where(
      and(
        eq(contentQualityChecks.assetId, assetId),
        eq(contentQualityChecks.revision, revision),
      ),
    );
  return rows.map((r) => ({
    key: r.checkKey,
    severity: r.severity,
    passed: r.passed,
    detail: r.detail,
  }));
}

async function isClaimCorrectionDraft(
  asset: Pick<ContentAsset, "projectId" | "opportunityId">,
) {
  if (!asset.opportunityId) return false;
  return (
    (await getOpportunity(asset.projectId, asset.opportunityId))?.dataSource ===
    "claim_correction"
  );
}

export const ContentRepository = {
  isClaimCorrectionDraft,
  ...ShopifyConnectionRepository,
  ...PublicationRepository,
  upsertOpportunities,
  listOpportunities,
  getOpportunity,
  listOpportunityEvidence,
  hasOpportunityEvidence,
  setOpportunityStatus,
  createAsset,
  getAsset,
  listAssets,
  updateAssetContent,
  listVersions,
  approveAsset,
  setAssetStatus,
  listReferences,
  replaceQualityChecks,
  listQualityChecks,
};
