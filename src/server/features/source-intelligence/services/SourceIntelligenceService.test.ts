import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  lookUpFanOutMetrics,
  quoteFanOutMetrics,
} from "./fanOutKeywordMetrics";
import { loadCitationProspects } from "./loadCitationProspects";
import { loadFanOutComparison } from "./loadFanOutComparison";
import { AiVisibilityRepository as repo } from "@/server/features/ai-visibility/repositories/AiVisibilityRepository";
import { ensurePromptSetVersion } from "@/server/features/ai-visibility/services/aiPromptSetVersions";
import { configuration } from "@/server/features/ai-visibility/services/aiVisibilityTestFixtures";
import { seedMeasurementRun } from "@/server/features/ai-visibility/services/aiMeasurementTestSeed";
import { OpportunityRepository } from "@/server/features/opportunities/repositories/OpportunityRepository";
import {
  createSourceOpportunity,
  decideSource,
  loadSourceDetail,
  loadSourceIntelligence,
  loadFanOutPrompts,
  loadFanOutQueryExport,
  loadFanOutAnswer,
  SourceActionRefusal,
} from "./SourceIntelligenceService";

const { testDb, lookupOverview } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } =
    await import("@/server/features/ai-visibility/aiVisibilityTestDb");
  return { testDb: await createAiVisibilityTestDb(), lookupOverview: vi.fn() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock(import("@/server/lib/dataforseo/labs"), async (original) => ({
  ...(await original()),
  fetchKeywordOverview: lookupOverview,
}));

const scope = { projectId: "project", organizationId: "organization" };
const daysAgo = (d: number) =>
  new Date(Date.now() - d * 86_400_000).toISOString();
const filters = { days: 90 as const, hideDismissed: true };
const query = {
  projectId: "project",
  filters,
  view: "sources" as const,
  sortBy: "cited" as const,
  sortDir: "desc" as const,
  page: 1,
  pageSize: 50 as const,
};

const PRICING = "https://rival.example/pricing";
const GUIDE = "https://blog.example/guide";
const OLD = "https://old.example/post";

async function observationIds(runId: string) {
  const result = await testDb.client.execute({
    sql: "SELECT id FROM ai_observations WHERE run_id = ? ORDER BY engine, id",
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

describe("source intelligence", () => {
  it("keeps retrieved and cited apart and does not call an uncaptured answer empty", async () => {
    const result = await loadSourceIntelligence(query);
    const byUrl = Object.fromEntries(result.rows.map((r) => [r.key, r]));
    expect(byUrl[PRICING]).toMatchObject({
      relation: "retrieved_and_cited",
      citedAnswers: 2,
      retrievedAnswers: 2,
      brand: "competitor",
    });
    expect(byUrl[GUIDE]).toMatchObject({
      relation: "retrieved_only",
      citedAnswers: 0,
      retrievedAnswers: 1,
    });
    expect(byUrl[OLD]).toMatchObject({
      relation: "cited_only",
      retrievedAnswers: 0,
    });
    expect(result.notes.join(" ")).toContain(
      "1 of 1 Gemini answers were saved before searches and retrieved pages were read",
    );
    expect(result.coverage.find((c) => c.engine === "chatgpt")).toMatchObject({
      answers: 2,
      queriesExposed: 2,
      retrievalExposed: 2,
      notCaptured: 0,
    });
  });

  it("ranks repeatedly cited independent pages and counts competitor mentions in those saved answers", async () => {
    await testDb.client.execute({
      sql: "INSERT INTO ai_sources (id, observation_id, url, domain, position) SELECT id || '-independent', id, ?, 'blog.example', 2 FROM ai_observations WHERE engine = 'chatgpt'",
      args: [GUIDE],
    });
    const rows = await loadCitationProspects("project", filters);
    expect(rows).toEqual([
      expect.objectContaining({
        key: GUIDE,
        citedAnswers: 2,
        competitors: [{ name: "Rival", domain: "rival.example", answers: 2 }],
      }),
    ]);
    expect(await loadCitationProspects("other", filters)).toEqual([]);
  });

  it("lists each reported search once with its answer count", async () => {
    const result = await loadSourceIntelligence({ ...query, view: "queries" });
    expect(result.queryRows).toEqual([
      expect.objectContaining({
        query: "rank tracker comparison",
        answers: 2,
        prompts: 2,
        engines: ["chatgpt"],
      }),
    ]);
  });

  it("prices only saved searches in the selected market and records the billed lookup", async () => {
    const selection = {
      filters: { ...filters, locationCode: 2840, languageCode: "en" },
      terms: ["rank tracker comparison"],
    };
    const quote = await quoteFanOutMetrics("project", selection);
    await expect(quoteFanOutMetrics("other", selection)).rejects.toThrow(
      "selected searches have changed",
    );
    const scopeWithEmail = {
      ...scope,
      userId: "writer",
      userEmail: "writer@example.com",
    };
    lookupOverview.mockResolvedValue({
      billing: { costUsd: 0.008, path: ["dataforseo_labs"] },
      data: [
        {
          keyword: "rank tracker comparison",
          keyword_info: { search_volume: 0 },
          keyword_properties: { keyword_difficulty: 43 },
        },
      ],
    });
    expect(lookupOverview).not.toHaveBeenCalled();
    await expect(
      lookUpFanOutMetrics(scopeWithEmail, selection, quote.estimatedUsd),
    ).resolves.toEqual({ checked: 1, reported: 1 });
    expect(lookupOverview).toHaveBeenCalledOnce();
    expect(
      (
        await loadFanOutQueryExport({ ...query, filters: selection.filters })
      )[0],
    ).toMatchObject({ searchVolume: 0, keywordDifficulty: 43 });
    expect((await quoteFanOutMetrics("project", selection)).estimatedUsd).toBe(
      0,
    );
    const costs = await testDb.client.execute(
      "SELECT cost_usd FROM provider_costs WHERE operation = 'fan_out_keyword_metrics'",
    );
    expect(costs.rows).toMatchObject([{ cost_usd: 0.008 }]);
  });

  it("exports all matching rows with metrics only from the selected project and market", async () => {
    await testDb.client.execute(`
      INSERT INTO keyword_metrics
        (project_id, keyword, location_code, language_code, search_volume, keyword_difficulty)
      VALUES
        ('project', 'rank tracker comparison', 2840, 'en', 0, 18),
        ('project', 'rank tracker comparison', 2840, 'es', 600, 81),
        ('project', 'rank tracker comparison', 2826, 'en', 700, 82),
        ('other', 'rank tracker comparison', 2840, 'en', 800, 83)
    `);
    const byQuery = { ...query, view: "queries" as const };
    const marketFilters = {
      ...filters,
      locationCode: 2840,
      languageCode: "en",
    };
    const expected: unknown = expect.objectContaining({
      query: "rank tracker comparison",
      answers: 2,
      searchVolume: 0,
      keywordDifficulty: 18,
    });
    const paged = await loadSourceIntelligence({
      ...byQuery,
      filters: marketFilters,
    });
    expect(paged.queryRows).toEqual([expected]);
    const nextPage = { ...byQuery, page: 2, filters: marketFilters };
    expect((await loadSourceIntelligence(nextPage)).queryRows).toEqual([]);
    expect(await loadFanOutQueryExport(nextPage)).toEqual([expected]);
    expect(await loadFanOutQueryExport(byQuery)).toMatchObject([
      { searchVolume: null, keywordDifficulty: null },
    ]);
    expect(
      await loadFanOutQueryExport({
        ...byQuery,
        projectId: "other",
        filters: marketFilters,
      }),
    ).toEqual([]);
  });

  it("compares reported search share across matching prompt cohorts and preserves unknown capture", async () => {
    const current = await testDb.client.execute(
      "SELECT id, tracker_id, prompt_set_version_id FROM ai_runs WHERE project_id = 'project'",
    );
    const run = current.rows[0];
    const promptIds = (
      await testDb.client.execute({
        sql: "SELECT prompt_id FROM ai_observations WHERE run_id = ? AND engine = 'chatgpt' ORDER BY id",
        args: [run.id],
      })
    ).rows.map((row) => z.string().parse(row.prompt_id));
    const selection = {
      days: 7 as const,
      hideDismissed: true,
      engine: "chatgpt" as const,
      locationCode: 2840,
      languageCode: "en",
    };
    await expect(
      loadFanOutComparison("project", selection),
    ).resolves.toMatchObject({ comparable: false });

    const context = {
      trackerId: z.string().parse(run.tracker_id),
      versionId: z.string().parse(run.prompt_set_version_id),
      promptIds,
    };
    for (const day of [10, 9, 4]) {
      const runId = await seedMeasurementRun(
        testDb.db,
        context,
        [{ prompt: 0 }, { prompt: 1 }],
        { createdAt: daysAgo(day) },
      );
      const [first, second] = await observationIds(runId);
      // The empty list is a completed capture and counts in the denominator.
      await capture(first, [], day < 7 ? ["new search"] : []);
      await capture(second, [], []);
    }
    // This historical answer contributes to the coverage count but has no list.
    await seedMeasurementRun(testDb.db, context, [{ prompt: 0 }], {
      createdAt: daysAgo(3),
    });

    expect(await loadFanOutComparison("project", selection)).toMatchObject({
      comparable: true,
      prompts: 2,
      beforeAnswers: 4,
      afterAnswers: 4,
      afterTotal: 5,
      changes: expect.arrayContaining([
        expect.objectContaining({
          query: "new search",
          beforePct: 0,
          afterPct: 25,
          change: 25,
        }),
      ]) as unknown,
    });
    expect(await loadFanOutComparison("other", selection)).toMatchObject({
      comparable: false,
    });
  });

  it("keeps project scope, saved searches, retrieval and citation when drilling into a prompt", async () => {
    const groups = await loadFanOutPrompts("project", query.filters, 1, 25);
    expect(groups.rows.reduce((sum, row) => sum + Number(row.total), 0)).toBe(
      3,
    );
    expect(
      groups.rows.reduce((sum, row) => sum + Number(row.reported), 0),
    ).toBe(2);
    const source = await loadSourceDetail("project", query.filters, GUIDE);
    const answerId = source.appearances[0]?.observationId;
    expect(answerId).toBeTruthy();
    const answer = await loadFanOutAnswer("project", answerId);
    expect(answer?.queries).toEqual(["rank tracker comparison"]);
    expect(answer?.retrieved.map((page) => page.url)).toContain(GUIDE);
    expect(answer?.cited.map((page) => page.url)).not.toContain(GUIDE);
    expect(await loadFanOutAnswer("other", answerId)).toBeNull();
  });

  it("never reads another project's answers", async () => {
    const result = await loadSourceIntelligence({
      ...query,
      projectId: "other",
    });
    expect(result.rows).toEqual([]);
    expect(result.answers).toBe(0);
  });

  it("hides a dismissed domain until the decision is cleared", async () => {
    await decideSource({
      projectId: "project",
      domain: "rival.example",
      decision: "dismiss",
      userId: "user",
    });
    const hidden = await loadSourceIntelligence(query);
    expect(hidden.rows.map((r) => r.key)).not.toContain(PRICING);
    await decideSource({
      projectId: "project",
      domain: "rival.example",
      decision: "clear",
      userId: "user",
    });
    const shown = await loadSourceIntelligence(query);
    expect(shown.rows.map((r) => r.key)).toContain(PRICING);
  });

  it("stores one opportunity per page and action, with a measurement caveat", async () => {
    const first = await createSourceOpportunity(scope, {
      filters,
      url: PRICING,
      action: "third_party",
    });
    const again = await createSourceOpportunity(scope, {
      filters,
      url: PRICING,
      action: "third_party",
    });
    expect(again.opportunityId).toBe(first.opportunityId);
    const detail = await OpportunityRepository.getOpportunityDetail(
      scope.projectId,
      first.opportunityId,
    );
    expect(detail?.opportunity.recommendedAction).toBe(
      "earn_third_party_coverage",
    );
    expect(detail?.opportunity.priority).toBe("medium");
    expect(detail?.evidence.some((e) => e.label === "Measurement caveat")).toBe(
      true,
    );
  });

  it("never recommends an article for a commercial source and refuses unknown pages", async () => {
    const result = await loadSourceDetail("project", filters, PRICING);
    expect(result.appearances).toHaveLength(2);
    expect(result.appearances[0].queries).toEqual(["rank tracker comparison"]);
    const content = await createSourceOpportunity(scope, {
      filters,
      url: PRICING,
      action: "content",
    });
    const stored = await OpportunityRepository.getOpportunityDetail(
      scope.projectId,
      content.opportunityId,
    );
    expect(stored?.opportunity.recommendedAction).toBe("create_page");
    await expect(
      createSourceOpportunity(scope, {
        filters,
        url: "https://nowhere.example/x",
        action: "content",
      }),
    ).rejects.toBeInstanceOf(SourceActionRefusal);
  });
});
