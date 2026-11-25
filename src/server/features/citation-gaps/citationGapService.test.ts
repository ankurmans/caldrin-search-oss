import { sort } from "remeda";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiVisibilityRepository as repo } from "@/server/features/ai-visibility/repositories/AiVisibilityRepository";
import { ensurePromptSetVersion } from "@/server/features/ai-visibility/services/aiPromptSetVersions";
import { configuration } from "@/server/features/ai-visibility/services/aiVisibilityTestFixtures";
import { seedMeasurementRun } from "@/server/features/ai-visibility/services/aiMeasurementTestSeed";
import { OpportunityRepository } from "@/server/features/opportunities/repositories/OpportunityRepository";
import {
  coveredRules,
  ruleKindOf,
} from "@/server/features/opportunities/rules/reconcileRules";
import {
  analyzeCitationGaps,
  createGapOpportunity,
  loadCitationSource,
  rankCitationActions,
} from "./citationGapService";

const { testDb } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } =
    await import("@/server/features/ai-visibility/aiVisibilityTestDb");
  return { testDb: await createAiVisibilityTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));

const daysAgo = (d: number) =>
  new Date(Date.now() - d * 86_400_000).toISOString();
const scope = { projectId: "project", organizationId: "organization" };
const input = { projectId: "project", days: 28 as const };

beforeEach(async () => {
  await testDb.seedProject();
  await testDb.client.execute(
    "INSERT INTO projects (id, organization_id, name, domain) VALUES ('other', 'organization', 'Other', 'other.example')",
  );
  const rows = configuration({
    engines: ["chatgpt"],
    prompts: [{ text: "Best rank tracker?" }, { text: "Which SEO tools?" }],
  });
  await repo.saveConfiguration(rows);
  const promptIds = rows.prompts.map((p) => p.id);
  const versionId = await ensurePromptSetVersion(rows.tracker.id, promptIds);
  // Labeled demo answers: the rival is named and its own pricing page cited.
  for (const createdAt of [daysAgo(3), daysAgo(2)])
    await seedMeasurementRun(
      testDb.db,
      { trackerId: rows.tracker.id, promptIds, versionId },
      [0, 1].map((prompt) => ({
        prompt,
        rivalMentioned: true,
        text: "Rival is often picked [rival.example](https://rival.example/pricing).",
        sources: ["https://rival.example/pricing"],
      })),
      { createdAt },
    );
});

describe("citation gaps service", () => {
  it("creates one opportunity per finding, idempotently, and marks it on the analysis", async () => {
    const before = await analyzeCitationGaps(input);
    const gap = before.findings.find(
      (f) => f.type === "missing_commercial_content",
    )!;
    expect(gap.opportunityId).toBeNull();

    const first = await createGapOpportunity(scope, {
      ...input,
      findingKey: gap.key,
    });
    const again = await createGapOpportunity(scope, {
      ...input,
      findingKey: gap.key,
    });
    expect(again.opportunityId).toBe(first.opportunityId);

    const detail = await OpportunityRepository.getOpportunityDetail(
      "project",
      first.opportunityId,
    );
    expect(detail?.opportunity).toMatchObject({
      dataSource: "ai_visibility",
      recommendedAction: "new_article",
    });
    const after = await analyzeCitationGaps(input);
    expect(after.findings.find((f) => f.key === gap.key)?.opportunityId).toBe(
      first.opportunityId,
    );
  });

  it("ranks actions and reads before and after only once one is stored", async () => {
    const { actions } = await rankCitationActions(input);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.map((a) => a.rank)).toEqual(actions.map((_, i) => i + 1));
    expect(actions.every((a) => a.reading === null)).toBe(true);
    const order = { high: 0, medium: 1, low: 2 };
    expect(actions.map((a) => order[a.priority])).toEqual(
      sort(
        actions.map((a) => order[a.priority]),
        (a, b) => a - b,
      ),
    );

    await createGapOpportunity(scope, {
      ...input,
      findingKey: actions[0].findingKey,
    });
    const stored = (await rankCitationActions(input)).actions.find(
      (a) => a.findingKey === actions[0].findingKey,
    )!;
    expect(stored.opportunityStatus).toBe("open");
    expect(stored.reading?.note).toMatch(/too few to compare/);
  });

  it("finds nothing for another project and creates nothing there", async () => {
    const mine = await analyzeCitationGaps(input);
    const key = mine.findings[0].key;
    expect(
      (await analyzeCitationGaps({ ...input, projectId: "other" })).findings,
    ).toEqual([]);
    await expect(
      createGapOpportunity(
        { projectId: "other", organizationId: "organization" },
        { ...input, projectId: "other", findingKey: key },
      ),
    ).rejects.toThrow(/no longer in the latest answers/);
    expect(await OpportunityRepository.listOpportunities("other")).toEqual([]);
  });

  it("quotes the saved answer around a cited source, for this project only", async () => {
    const detail = await loadCitationSource({
      ...input,
      domain: "www.Rival.example",
    });
    expect(detail.kind).toBe("competitor");
    expect(detail.answers).toHaveLength(4);
    expect(detail.answers[0].passages).toEqual(["Rival is often picked ."]);
    expect(
      (
        await loadCitationSource({
          ...input,
          projectId: "other",
          domain: "rival.example",
        })
      ).answers,
    ).toEqual([]);
  });

  it("is never pruned by an opportunity analysis run", () => {
    expect(ruleKindOf("ai_gap::missing_commercial_content::General")).toBe(
      "ai_gap",
    );
    const everything = coveredRules(
      {
        gsc: { source: "gsc", rows: [], windowStart: "", windowEnd: "" },
        pageWindows: {
          current: [],
          previous: [],
          currentStart: "",
          currentEnd: "",
          previousStart: "",
          previousEnd: "",
        },
        store: null,
        storeMode: null,
        audit: { auditId: "a", observedAt: "", issues: [] },
        brandTerms: [],
        unavailable: [],
      },
      true,
    );
    expect(everything.has("ai_gap")).toBe(false);
  });
});
