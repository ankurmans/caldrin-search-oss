import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateText } from "ai";
import type * as AiModule from "ai";
import { AiVisibilityRepository as repo } from "@/server/features/ai-visibility/repositories/AiVisibilityRepository";
import { ensurePromptSetVersion } from "@/server/features/ai-visibility/services/aiPromptSetVersions";
import { configuration } from "@/server/features/ai-visibility/services/aiVisibilityTestFixtures";
import { seedMeasurementRun } from "@/server/features/ai-visibility/services/aiMeasurementTestSeed";
import type { CustomerContext } from "@/server/lib/customer-context";
import { addBrandFact, checkRunFacts, factCheckReport } from "./aiFactChecks";

const { testDb } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } =
    await import("@/server/features/ai-visibility/aiVisibilityTestDb");
  return { testDb: await createAiVisibilityTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof AiModule>()),
  generateText: vi.fn(),
}));
vi.mock("@/server/lib/openrouter", () => ({
  requireOpenRouterAccess: async () => ({ apiKey: "key" }),
  buildChatAgentModel: () => "model",
}));
vi.mock("@/server/lib/runtime-env", () => ({
  getOptionalEnvValue: async () => undefined,
}));
vi.mock("@/server/lib/llmCost", () => ({ llmCostUsd: () => 0.001 }));
vi.mock("@/server/features/workspace/researchSpend", () => ({
  withResearchAdmission: (_: unknown, run: () => Promise<void>) => run(),
  recordResearchSpend: vi.fn(),
}));

const customer: CustomerContext = {
  organizationId: "organization",
  userId: "user",
  userEmail: "user@example.com",
};
const ANSWER = "Caldrin Search costs $99 a month and tracks AI answers.";
let runId: string;

const verdict = (id: string, quote: string) =>
  vi.mocked(generateText).mockResolvedValue({
    output: { facts: [{ id, verdict: "contradicted", quote }] },
    response: { modelId: "small-model" },
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the two result fields the service reads
  } as never);

beforeEach(async () => {
  await testDb.seedProject();
  const rows = configuration({
    engines: ["chatgpt"],
    prompts: [{ text: "Best rank tracker?" }, { text: "Which SEO tools?" }],
  });
  await repo.saveConfiguration(rows);
  const promptIds = rows.prompts.map((p) => p.id);
  const versionId = await ensurePromptSetVersion(rows.tracker.id, promptIds);
  runId = await seedMeasurementRun(
    testDb.db,
    { trackerId: rows.tracker.id, promptIds, versionId },
    [
      { prompt: 0, mentioned: true, text: ANSWER },
      { prompt: 1, mentioned: false, text: "Rival is popular." },
    ],
  );
});

describe("brand fact checks", () => {
  it("reads only answers naming the brand, once, and reports the contradiction", async () => {
    const { id } = await addBrandFact(
      "project",
      "Caldrin Search costs $49 a month.",
    );
    expect(
      await addBrandFact("project", "caldrin search costs $49 a month."),
    ).toEqual({ id });
    verdict(id, "costs $99 a month");

    const first = await checkRunFacts(
      { projectId: "project", runId },
      customer,
    );
    expect(first).toMatchObject({
      answersRead: 1,
      checksSaved: 1,
      remaining: 0,
    });
    await checkRunFacts({ projectId: "project", runId }, customer);
    expect(generateText).toHaveBeenCalledTimes(1);

    const report = await factCheckReport({ projectId: "project", runId });
    expect(report.answersNamingBrand).toBe(1);
    expect(report.facts[0]).toMatchObject({ contradicted: 1, unchecked: 0 });
    expect(report.facts[0].contradictions[0]).toMatchObject({
      quote: "costs $99 a month",
      model: "small-model",
    });
  });

  it("drops a quote that is not in the answer", async () => {
    const { id } = await addBrandFact(
      "project",
      "Caldrin Search costs $49 a month.",
    );
    verdict(id, "costs $12 a month");
    await checkRunFacts({ projectId: "project", runId }, customer);
    const report = await factCheckReport({ projectId: "project" });
    expect(report.facts[0].contradictions[0].quote).toBeNull();
  });
});
