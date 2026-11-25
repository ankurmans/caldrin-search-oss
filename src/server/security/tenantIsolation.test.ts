import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpportunityRepository } from "@/server/features/opportunities/repositories/OpportunityRepository";
import { ContentRepository } from "@/server/features/content/repositories/ContentRepository";
import { SpendService } from "@/server/features/spend/services/SpendService";
import { createMigratedDatabase } from "./sqlite-test-db";

const state = vi.hoisted(() => ({
  database: null as DatabaseSync | null,
  workerEnv: {} as Record<string, string>,
}));
vi.mock("cloudflare:workers", () => ({ env: state.workerEnv }));
vi.mock("@/db", async () => {
  const { createProxyDb } = await import("./sqlite-test-db");
  return { db: createProxyDb(() => state.database) };
});

// Two organizations, one project each. Every function below takes the
// projectId the server resolved from the session; this proves that a caller
// holding project B's id can neither read nor change anything of project A's.
const A = { projectId: "project-a", organizationId: "org-1", userId: "user-a" };
const B = { projectId: "project-b", organizationId: "org-2", userId: "user-b" };

beforeEach(() => {
  state.database?.close();
  state.database = createMigratedDatabase();
});

const decision = {
  query: "best beans",
  action: "new_article" as const,
  reason: "r",
  pageUrl: "https://a.test/p",
  impressions: 100,
  clicks: 1,
  ctr: 0.01,
  position: 8,
  matchedCollectionHandle: null,
};

function opportunities(scope: typeof A, impressions: number) {
  return ContentRepository.upsertOpportunities({
    projectId: scope.projectId,
    organizationId: scope.organizationId,
    decisions: [{ ...decision, impressions }],
    dataSource: "simulated",
    windowStart: "2026-10-01",
    windowEnd: "2026-10-28",
  });
}

function asset(scope: typeof A) {
  return ContentRepository.createAsset({
    projectId: scope.projectId,
    organizationId: scope.organizationId,
    opportunityId: null,
    title: "Draft",
    searchIntent: "x",
    briefMarkdown: "x",
    bodyHtml: "<p>x</p>",
    metaTitle: "m",
    metaDescription: "d",
    generator: "template",
    createdByUserId: scope.userId,
    references: [],
  });
}

describe("content opportunities", () => {
  it("keeps the same query on the same page separate per project", async () => {
    await opportunities(A, 100);
    await opportunities(B, 200);
    const [a] = await ContentRepository.listOpportunities(A.projectId);
    const [b] = await ContentRepository.listOpportunities(B.projectId);
    expect([a?.impressions, b?.impressions]).toEqual([100, 200]);
    expect(a?.id).not.toBe(b?.id);
  });

  it("does not let another project read or change an opportunity", async () => {
    await opportunities(A, 100);
    const [a] = await ContentRepository.listOpportunities(A.projectId);
    if (!a) throw new Error("seed failed");
    expect(
      await ContentRepository.getOpportunity(B.projectId, a.id),
    ).toBeNull();
    await ContentRepository.setOpportunityStatus(
      B.projectId,
      a.id,
      "dismissed",
    );
    expect(
      (await ContentRepository.getOpportunity(A.projectId, a.id))?.status,
    ).toBe("open");
  });
});

describe("content assets", () => {
  it("does not let another project change status or content of a draft", async () => {
    const created = await asset(A);
    await ContentRepository.setAssetStatus(
      B.projectId,
      created.id,
      "published",
    );
    await ContentRepository.updateAssetContent(
      B.projectId,
      created.id,
      B.userId,
      { title: "hijack", bodyHtml: "x", metaTitle: "m", metaDescription: "d" },
    );
    await ContentRepository.approveAsset(B.projectId, created.id, 1, B.userId);
    expect(
      await ContentRepository.getAsset(A.projectId, created.id),
    ).toMatchObject({
      title: "Draft",
      status: "draft",
      revision: 1,
      approvedByUserId: null,
    });
    expect(await ContentRepository.listAssets(B.projectId)).toEqual([]);
  });

  it("lists published articles and costs only for the asking project", async () => {
    const created = await asset(A);
    await ContentRepository.logCost({
      projectId: A.projectId,
      assetId: created.id,
      provider: "llm",
      operation: "llm_draft",
      costUsd: 0.2,
    });
    expect(await ContentRepository.sumCostUsd(B.projectId)).toBe(0);
    expect(
      await ContentRepository.countCostsSince(
        B.projectId,
        "llm_draft",
        "2000-01-01",
      ),
    ).toBe(0);
    expect(await ContentRepository.listPublishedArticles(B.projectId)).toEqual(
      [],
    );
  });
});

const connection = (scope: typeof A, shopDomain: string) => ({
  projectId: scope.projectId,
  organizationId: scope.organizationId,
  shopDomain,
  mode: "live" as const,
  sealedAccessToken: "sealed-a",
  grantedScopes: "read_content",
  canPublish: false,
  apiVersion: "2025-10",
  connectedByUserId: scope.userId,
});

describe("shopify connection", () => {
  it("never returns, rewrites or disconnects another project's store", async () => {
    await ContentRepository.upsertConnection(connection(A, "a.myshopify.com"));
    expect(await ContentRepository.getConnection(B.projectId)).toBeNull();
    await ContentRepository.updateTokens(B.projectId, {
      sealedAccessToken: "stolen",
      sealedRefreshToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
    });
    await ContentRepository.deleteConnection(B.projectId);
    expect(await ContentRepository.getConnection(A.projectId)).toMatchObject({
      shopDomain: "a.myshopify.com",
      sealedAccessToken: "sealed-a",
    });
  });
});

describe("spend and cost records", () => {
  it("keeps limits, spend and cost rows per project", async () => {
    await SpendService.setLimits(A, {
      dailyUsd: 1,
      monthlyUsd: 10,
      scheduledJobsPerDay: 3,
    });
    await SpendService.recordCost(A, {
      provider: "dataforseo",
      operation: "serp",
      costUsd: 0.5,
    });
    expect(await SpendService.getLimits(B.projectId)).toEqual({
      dailyUsd: null,
      monthlyUsd: null,
      scheduledJobsPerDay: null,
    });
    expect(await SpendService.getSpend(B.projectId)).toEqual({
      todayUsd: 0,
      monthUsd: 0,
      byProvider: [],
    });
  });

  it("writes the caller's own project and organization on a cost row, and B's limit change leaves A's alone", async () => {
    await SpendService.setLimits(A, {
      dailyUsd: 1,
      monthlyUsd: null,
      scheduledJobsPerDay: null,
    });
    await SpendService.setLimits(B, {
      dailyUsd: 99,
      monthlyUsd: null,
      scheduledJobsPerDay: null,
    });
    await SpendService.recordCost(B, {
      provider: "llm",
      operation: "llm_draft",
      costUsd: 0.1,
    });
    expect((await SpendService.getLimits(A.projectId)).dailyUsd).toBe(1);
    const rows = state.database
      ?.prepare("SELECT project_id, organization_id FROM provider_costs")
      .all();
    expect(rows).toEqual([
      { project_id: "project-b", organization_id: "org-2" },
    ]);
  });
});

const candidate = (evidenceValue: string) => ({
  dedupeKey: "best beans|https://a.test/p",
  query: "best beans",
  pageUrl: "https://a.test/p",
  action: "new_article" as const,
  reason: "r",
  matchedCollectionHandle: null,
  dataSource: "simulated" as const,
  intent: null,
  priority: "high" as const,
  priorityReason: "p",
  observedAt: "2026-11-16T00:00:00Z",
  impressions: 100,
  clicks: 1,
  ctr: 0.01,
  position: 8,
  windowStart: "2026-10-01",
  windowEnd: "2026-10-28",
  evidence: [{ source: "gsc", label: "impressions", value: evidenceValue }],
});

describe("search opportunities", () => {
  it("keeps rows and evidence apart when two projects share a dedupe key", async () => {
    const idA = await OpportunityRepository.upsertCandidate(A, candidate("a"));
    const idB = await OpportunityRepository.upsertCandidate(B, candidate("b"));
    expect(idA).not.toBe(idB);
    const detailA = await OpportunityRepository.getOpportunityDetail(
      A.projectId,
      idA,
    );
    expect(detailA?.evidence.map((e) => e.value)).toEqual(["a"]);
  });

  it("does not let another project read, change or count a project's opportunity", async () => {
    const id = await OpportunityRepository.upsertCandidate(A, candidate("a"));
    expect(
      await OpportunityRepository.getOpportunityDetail(B.projectId, id),
    ).toBeNull();
    expect(await OpportunityRepository.listOpportunities(B.projectId)).toEqual(
      [],
    );
    expect(
      await OpportunityRepository.setStatus(B.projectId, id, "dismissed"),
    ).toBe(false);
    expect(
      (await OpportunityRepository.countEvidence(B.projectId, [id])).size,
    ).toBe(0);
    expect(
      (await OpportunityRepository.getOpportunityDetail(A.projectId, id))
        ?.opportunity.status,
    ).toBe("open");
  });
});
