import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiVisibilityRepository as repo } from "@/server/features/ai-visibility/repositories/AiVisibilityRepository";
import { configuration } from "@/server/features/ai-visibility/services/aiVisibilityTestFixtures";
import type { CustomerContext } from "@/server/lib/customer-context";
import { replayExperiment } from "./experimentReplay";
import {
  approveExperiment,
  createExperiment,
  getExperiment,
  updateExperiment,
} from "./perceptionExperiments";
import { readAnswerPerception } from "./perceptionReading";

const { testDb } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } =
    await import("@/server/features/ai-visibility/aiVisibilityTestDb");
  return { testDb: await createAiVisibilityTestDb() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
// The answer names the brand only when the page it was handed says so.
vi.mock("ai", () => ({
  generateText: async ({ prompt }: { prompt: string }) => ({
    text: prompt.includes("BEST-IN-CLASS")
      ? "Caldrin Search is the best pick."
      : "Try a tracker.",
    response: { modelId: "small-model" },
  }),
}));
vi.mock("./perceptionReading", () => ({ readAnswerPerception: vi.fn() }));
vi.mock("@/server/lib/llmCost", () => ({ llmCostUsd: () => 0.001 }));
vi.mock("@/server/lib/openrouter", () => ({
  requireOpenRouterAccess: async () => ({ apiKey: "key" }),
  buildChatAgentModel: () => ({}),
}));
vi.mock("@/server/lib/runtime-env", () => ({
  getOptionalEnvValue: async () => undefined,
}));
vi.mock("@/server/features/workspace/researchSpend", () => ({
  withResearchAdmission: (_: unknown, run: () => Promise<void>) => run(),
  recordResearchSpend: vi.fn(),
}));

const customer: CustomerContext = {
  organizationId: "organization",
  userId: "user",
  userEmail: "user@example.com",
};
const scope = { projectId: "project", userId: null };
let promptIds: string[];

const fields = () => ({
  title: "Lead with proof",
  sourceUrl: null,
  originalText: "We build rank trackers.",
  editedText: "BEST-IN-CLASS rank tracker.",
  assumptions: "An engine would cite this page.",
  repeats: 3,
  promptIds: promptIds.slice(0, 1),
});

beforeEach(async () => {
  await testDb.seedProject();
  const rows = configuration({
    engines: ["chatgpt"],
    prompts: [{ text: "Best rank tracker?" }],
  });
  await repo.saveConfiguration(rows);
  promptIds = rows.prompts.map((p) => p.id);
  vi.mocked(readAnswerPerception).mockResolvedValue({
    model: "small-model",
    costUsd: 0.002,
    readings: [
      {
        domain: "caldrin.co",
        name: "Caldrin Search",
        own: true,
        stance: "recommended",
        sentiment: "positive",
        confidence: "high",
        evidence: "the best pick",
        ambiguousName: false,
        points: [],
        comparisons: [],
      },
    ],
  });
});

describe("content experiments", () => {
  it("replays both versions, counts them separately and keeps the run labelled simulated", async () => {
    const { id } = await createExperiment(scope, fields());
    await expect(
      approveExperiment(
        { projectId: "project", organizationId: "organization" },
        id,
      ),
    ).rejects.toThrow(/Replay the edit/);

    const run = await replayExperiment(customer, { projectId: "project", id });
    expect(run).toMatchObject({ replays: 6, planned: 6 });

    const experiment = await getExperiment("project", id);
    expect(experiment?.simulationNote).toMatch(/^Simulated/);
    expect(experiment?.verdict).toMatchObject({
      call: "moved_up",
      control: { numerator: 0, denominator: 3 },
      variant: { numerator: 3, denominator: 3 },
    });
    // Only answers that name the brand are read, so a control that never
    // names it costs no reading.
    expect(readAnswerPerception).toHaveBeenCalledTimes(3);
  });

  it("clears the replay when the text changes, so an old result never describes new words", async () => {
    const { id } = await createExperiment(scope, fields());
    await replayExperiment(customer, { projectId: "project", id });
    await updateExperiment(scope, id, {
      ...fields(),
      editedText: "BEST-IN-CLASS and faster.",
    });
    const experiment = await getExperiment("project", id);
    expect(experiment).toMatchObject({ status: "draft", verdict: null });
  });

  it("approves a replayed edit into an opportunity once", async () => {
    const { id } = await createExperiment(scope, fields());
    await replayExperiment(customer, { projectId: "project", id });
    const approval = { projectId: "project", organizationId: "organization" };
    const first = await approveExperiment(approval, id);
    const second = await approveExperiment(approval, id);
    expect(second.opportunityId).toBe(first.opportunityId);
    expect(await getExperiment("project", id)).toMatchObject({
      status: "approved",
      approvedBy: "person",
    });
  });

  it("lets an agent queue a replay only when it measured a spread", async () => {
    const approval = { projectId: "project", organizationId: "organization" };
    const short = await createExperiment(scope, { ...fields(), repeats: 2 });
    await replayExperiment(customer, { projectId: "project", id: short.id });
    await expect(
      approveExperiment(approval, short.id, "agent"),
    ).rejects.toThrow(/at least 3 repeats/);

    const { id } = await createExperiment(scope, fields());
    await replayExperiment(customer, { projectId: "project", id });
    await expect(
      approveExperiment(approval, id, "agent"),
    ).resolves.toHaveProperty("opportunityId");
    expect((await getExperiment("project", id))?.approvedBy).toBe("agent");
  });
});
