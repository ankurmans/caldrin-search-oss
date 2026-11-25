import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EnsuredProject } from "@/middleware/ensure-user/types";
import type { CustomerContext } from "@/server/lib/customer-context";
import { KeywordSeedService } from "./KeywordSeedService";

const { listResearchKeywords, listSavedKeywordRowsByKeywords, research } =
  vi.hoisted(() => ({
    listResearchKeywords: vi.fn(),
    listSavedKeywordRowsByKeywords: vi.fn(),
    research: vi.fn(),
  }));

vi.mock("cloudflare:workers", () => ({ waitUntil: vi.fn() }));
vi.mock(
  "@/server/features/ai-visibility/repositories/AiVisibilityRepository",
  () => ({ AiVisibilityRepository: { listResearchKeywords } }),
);
vi.mock(
  "@/server/features/keywords/repositories/KeywordResearchRepository",
  () => ({ KeywordResearchRepository: { listSavedKeywordRowsByKeywords } }),
);
vi.mock("@/server/features/keywords/services/research", () => ({ research }));
vi.mock("@/server/features/keywords/services/KeywordSuggestionService", () => ({
  KeywordSuggestionService: { generate: vi.fn() },
}));

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- partial fixture: seeding reads only the id and market
const project = {
  id: "p1",
  locationCode: 2840,
  languageCode: "en",
} as EnsuredProject;
const customer: CustomerContext = {
  organizationId: "org",
  userId: "user",
  userEmail: "user@example.com",
};
const row = (keyword: string, searchVolume: number | null) => ({
  keyword,
  searchVolume,
  keywordDifficulty: 30,
  cpc: 1,
  competition: 0.2,
  intent: "commercial",
  trend: [],
});

beforeEach(() => {
  listResearchKeywords.mockResolvedValue(["ai transcription", "ai dictation"]);
  listSavedKeywordRowsByKeywords.mockResolvedValue([]);
});

describe("seeding keywords", () => {
  it("merges the seeds' ideas by volume, drops tiny and already-saved ones, and survives a failed seed", async () => {
    research
      .mockResolvedValueOnce({
        rows: [
          row("ai transcription", 5000),
          row("meeting notes ai", 900),
          row("rare phrase", 3),
        ],
      })
      .mockRejectedValueOnce(new Error("provider down"));
    listSavedKeywordRowsByKeywords.mockResolvedValue([
      { keyword: "meeting notes ai" },
    ]);

    const result = await KeywordSeedService.seed(project, customer);

    expect(result.keywords.map((k) => k.keyword)).toEqual(["ai transcription"]);
  });

  it("fails when every seed fails, so nothing looks like an empty result", async () => {
    research.mockRejectedValue(new Error("provider down"));
    await expect(KeywordSeedService.seed(project, customer)).rejects.toThrow(
      "provider down",
    );
  });
});
