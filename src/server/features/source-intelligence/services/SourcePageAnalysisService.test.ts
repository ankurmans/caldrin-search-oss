import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiVisibilityRepository as repo } from "@/server/features/ai-visibility/repositories/AiVisibilityRepository";
import { ensurePromptSetVersion } from "@/server/features/ai-visibility/services/aiPromptSetVersions";
import { configuration } from "@/server/features/ai-visibility/services/aiVisibilityTestFixtures";
import { seedMeasurementRun } from "@/server/features/ai-visibility/services/aiMeasurementTestSeed";
import { OpportunityRepository } from "@/server/features/opportunities/repositories/OpportunityRepository";
import { SpendService } from "@/server/features/spend/services/SpendService";
import { SpendLimitRefusal } from "@/server/features/spend/types";
import { readPages } from "@/server/lib/scrape";
import { readPageText } from "./pageReader";
import {
  createSourceOpportunity,
  SourceActionRefusal,
} from "./SourceIntelligenceService";
import { analyseSourcePage } from "./SourcePageAnalysisService";

vi.mock("@/server/lib/scrape", () => ({ readPages: vi.fn() }));
vi.mock("./pageReader", () => ({ readPageText: vi.fn() }));
vi.mock("@/server/features/workspace/researchSpend", () => ({
  withResearchAdmission: (_customer: unknown, work: () => unknown) => work(),
}));

const { testDb } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } =
    await import("@/server/features/ai-visibility/aiVisibilityTestDb");
  return { testDb: await createAiVisibilityTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));

const scope = {
  projectId: "project",
  organizationId: "organization",
  userId: "user",
};
const customer = {
  projectId: "project",
  organizationId: "organization",
  userId: "user",
  userEmail: "user@example.com",
};
const daysAgo = (d: number) =>
  new Date(Date.now() - d * 86_400_000).toISOString();

const PRICING = "https://rival.example/pricing";
const GUIDE = "https://blog.example/guide";
const OLD = "https://old.example/post";

async function observationIds(runId: string) {
  const result = await testDb.client.execute({
    sql: "SELECT id FROM ai_observations WHERE run_id = ? ORDER BY id",
    args: [runId],
  });
  return result.rows.flatMap((row) =>
    typeof row.id === "string" ? [row.id] : [],
  );
}

async function capture(
  observationId: string,
  retrieved: string[],
  queries: string[],
) {
  await testDb.client.execute({
    sql: "UPDATE ai_observations SET queries_exposed = 1, retrieval_exposed = 1 WHERE id = ?",
    args: [observationId],
  });
  for (const [i, url] of retrieved.entries())
    await testDb.client.execute({
      sql: "INSERT INTO ai_observation_retrievals (id, observation_id, url, domain, position) VALUES (?, ?, ?, ?, ?)",
      args: [
        `${observationId}-r${i}`,
        observationId,
        url,
        new URL(url).host,
        i + 1,
      ],
    });
  for (const [i, text] of queries.entries())
    await testDb.client.execute({
      sql: "INSERT INTO ai_observation_queries (id, observation_id, query, position) VALUES (?, ?, ?, ?)",
      args: [`${observationId}-q${i}`, observationId, text, i + 1],
    });
}

beforeEach(async () => {
  await testDb.seedProject();
  await testDb.client.execute(
    "INSERT INTO projects (id, organization_id, name, domain) VALUES ('other', 'organization', 'Other', 'other.example')",
  );
  const rows = configuration({
    engines: ["chatgpt", "gemini"],
    prompts: [{ text: "Best rank tracker?" }, { text: "Which SEO tools?" }],
  });
  await repo.saveConfiguration(rows);
  const promptIds = rows.prompts.map((p) => p.id);
  const versionId = await ensurePromptSetVersion(rows.tracker.id, promptIds);
  const runId = await seedMeasurementRun(
    testDb.db,
    { trackerId: rows.tracker.id, promptIds, versionId },
    [
      { prompt: 0, rivalMentioned: true, sources: [PRICING] },
      { prompt: 1, rivalMentioned: true, sources: [PRICING] },
      // Saved before searches and retrieved pages were read.
      { prompt: 0, engine: "gemini", sources: [OLD] },
    ],
    { createdAt: daysAgo(2) },
  );
  const [first, second] = await observationIds(runId);
  await capture(first, [PRICING, GUIDE], ["rank tracker comparison"]);
  await capture(second, [PRICING], ["rank tracker comparison"]);
});

beforeEach(() => {
  vi.mocked(readPages).mockResolvedValue({
    blocked: false,
    pages: [
      {
        url: PRICING,
        title: "Rival pricing",
        text: "Rival is a rank tracker. Prices as of 2023 start at $29.",
      },
    ],
  });
  vi.mocked(readPageText).mockResolvedValue({
    costUsd: 0.004,
    reading: {
      summary: "Pricing for Rival's rank tracker.",
      pageKind: "vendor_page",
      buyerQuestions: ["How much does a rank tracker cost?"],
      datedFacts: ["Prices as of 2023 start at $29"],
    },
  });
});

const run = (
  over: Partial<Parameters<typeof analyseSourcePage>[2]> = {},
  s = scope,
  c = customer,
) =>
  analyseSourcePage(c, s, {
    url: PRICING,
    confirm: true,
    refresh: false,
    ...over,
  });

describe("source page analysis", () => {
  it("prices a reading without fetching or charging", async () => {
    const result = await run({ confirm: false });
    expect(result).toMatchObject({ status: "preview", estimatedUsd: 0.05 });
    expect(readPages).not.toHaveBeenCalled();
    expect(readPageText).not.toHaveBeenCalled();
  });

  it("takes brand and competitor mentions from the page text, not the model", async () => {
    const result = await run();
    if (result.status !== "done") throw new Error("expected a reading");
    expect(result.analysis).toMatchObject({
      namesBrand: false,
      competitorDomain: true,
      approach: "owned_content_gap",
    });
    expect(
      result.analysis.items.filter((i) => i.kind === "competitor_named"),
    ).toEqual([{ kind: "competitor_named", text: "Rival" }]);
  });

  it("reuses a fresh reading until a new one is asked for", async () => {
    await run();
    const again = await run({ confirm: false });
    expect(again).toMatchObject({ status: "done", costUsd: 0 });
    expect(readPageText).toHaveBeenCalledTimes(1);
  });

  it("only reads pages that appeared in this project's answers", async () => {
    await expect(
      run({ url: "https://elsewhere.example/x" }),
    ).rejects.toBeInstanceOf(SourceActionRefusal);
    await expect(
      run(
        {},
        { ...scope, projectId: "other" },
        { ...customer, projectId: "other" },
      ),
    ).rejects.toBeInstanceOf(SourceActionRefusal);
    expect(readPages).not.toHaveBeenCalled();
  });

  it("refuses before fetching when the spend limit would be passed", async () => {
    await SpendService.setLimits(scope, {
      dailyUsd: 0.01,
      monthlyUsd: null,
      scheduledJobsPerDay: null,
    });
    await expect(run()).rejects.toBeInstanceOf(SpendLimitRefusal);
    expect(readPages).not.toHaveBeenCalled();
  });

  it("puts the reading in an opportunity's evidence", async () => {
    await run();
    const { opportunityId } = await createSourceOpportunity(scope, {
      filters: { days: 90, hideDismissed: true },
      url: PRICING,
      action: "content",
    });
    const detail = await OpportunityRepository.getOpportunityDetail(
      scope.projectId,
      opportunityId,
    );
    expect(detail?.evidence.map((e) => e.label)).toEqual(
      expect.arrayContaining([
        "What the page covers",
        "Suggested approach",
        "Dated fact to check",
      ]),
    );
  });
});
