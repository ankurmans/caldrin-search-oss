import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiVisibilityRepository as repo } from "../repositories/AiVisibilityRepository";
import { configuration } from "./aiVisibilityTestFixtures";
import { lookupPromptVolumes } from "./aiPromptVolume";

const { testDb, keywordVolume } = await vi.hoisted(async () => {
  const { createAiVisibilityTestDb } = await import("../aiVisibilityTestDb");
  return { testDb: await createAiVisibilityTestDb(), keywordVolume: vi.fn() };
});
vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: testDb.db }));
vi.mock("@/db/runBatch", () => ({ runBatch: testDb.runBatch }));
vi.mock("@/server/lib/provider-access", () => ({
  hasDataforseoAccess: async () => true,
}));
vi.mock("@/server/lib/dataforseo", () => ({
  createDataforseoClient: () => ({ aiSearch: { keywordVolume } }),
}));

describe("lookupPromptVolumes", () => {
  beforeEach(async () => {
    await testDb.seedProject();
    await repo.saveConfiguration(
      configuration({
        engines: ["chatgpt"],
        prompts: [
          { text: "best crm for startups" },
          { text: "crm for a very specific niche" },
        ],
      }),
    );
  });

  it("saves none reported, not zero, for wording the provider has no figure for", async () => {
    keywordVolume.mockResolvedValue([
      { keyword: "Best CRM for startups", ai_search_volume: 320 },
    ]);

    const result = await lookupPromptVolumes(
      { projectId: "project" },
      {
        organizationId: "org",
        userId: "user",
        userEmail: "user@example.com",
      },
    );

    expect(result).toMatchObject({ looked: 2, reported: 1 });
    const config = await repo.getConfiguration("project");
    const saved = await repo.listPromptVolumes(
      config!.tracker.id,
      result.market,
    );
    const byText = new Map(
      config!.prompts.map((p) => [
        p.text,
        saved.find((v) => v.promptId === p.id)?.volume,
      ]),
    );
    expect(byText.get("best crm for startups")).toBe(320);
    expect(byText.get("crm for a very specific niche")).toBeNull();
  });
});
