import { beforeEach, describe, expect, it, vi } from "vitest";
import { getStoredBrandLookup } from "@/server/features/ai-search/services/brandLookup";
import { DomainIntersectionRepository } from "@/server/features/domain/repositories/DomainIntersectionRepository";
import { getStoredKeywordSample } from "@/server/features/domain/services/domainKeywordSample";
import { getStoredSerp } from "@/server/features/keywords/services/research/serp";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import { DomainIntersectionService } from "./domainIntersection";

vi.mock("cloudflare:workers", () => ({ env: {}, waitUntil: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/server/lib/dataforseo", () => ({ createDataforseoClient: vi.fn() }));
vi.mock("@/server/features/ai-search/services/brandLookup", () => ({
  getStoredBrandLookup: vi.fn(),
}));
vi.mock("@/server/features/domain/services/domainKeywordSample", () => ({
  getStoredKeywordSample: vi.fn(),
}));
vi.mock("@/server/features/keywords/services/research/serp", () => ({
  getStoredSerp: vi.fn(),
}));
vi.mock(
  "@/server/features/domain/repositories/DomainIntersectionRepository",
  () => ({
    DomainIntersectionRepository: {
      latestTrackedAnswers: vi.fn(),
      latestTrackedRanks: vi.fn(),
    },
  }),
);

const customer = { organizationId: "org", userId: "u", userEmail: "u@e.com" };
const input = {
  projectId: "p1",
  domain: "example.com",
  locationCode: 2840,
  languageCode: "en",
  projectDomain: "example.com",
};
const lookup = (citedDomain: string) =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- partial fixture: only the fields the intersection reads
  ({
    fetchedAt: "2026-05-12T00:00:00.000Z",
    topQueries: [
      {
        question: "best widget tool",
        platform: "google",
        aiSearchVolume: 10,
        firstSeenAt: null,
        lastSeenAt: "2026-05-12T00:00:00.000Z",
        citedSources: [
          { url: `https://${citedDomain}/p`, domain: citedDomain, title: null },
        ],
        brandsMentioned: [],
      },
    ],
  }) as never;

describe("DomainIntersectionService", () => {
  beforeEach(() => {
    vi.mocked(getStoredBrandLookup).mockResolvedValue(lookup("other.com"));
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- partial fixture: only the fields the intersection reads
    vi.mocked(getStoredKeywordSample).mockResolvedValue({
      domain: "example.com",
      totalCount: 1,
      fetchedAt: "2026-05-10T00:00:00.000Z",
      keywords: [
        {
          keyword: "Best widget tool?",
          position: 4,
          url: "https://example.com/widgets",
          serpCheckedAt: "2026-05-10T00:00:00.000Z",
        },
      ],
    } as never);
    vi.mocked(getStoredSerp).mockResolvedValue(null);
    vi.mocked(
      DomainIntersectionRepository.latestTrackedAnswers,
    ).mockResolvedValue([]);
    vi.mocked(
      DomainIntersectionRepository.latestTrackedRanks,
    ).mockResolvedValue([]);
  });

  it("pairs an AI question with the ranking page and reads stored data only", async () => {
    const result = await DomainIntersectionService.getIntersection(
      input,
      customer,
    );

    expect(result.rows[0]).toMatchObject({
      organicState: "ranked",
      aiState: "named_only",
      gap: "ranks_not_cited",
      opportunity: { ok: true, action: "refresh_existing_page" },
    });
    expect(createDataforseoClient).not.toHaveBeenCalled();
  });

  it("counts a citation of the explored domain, and a matching subdomain only under that scope", async () => {
    vi.mocked(getStoredBrandLookup).mockResolvedValue(
      lookup("blog.example.com"),
    );
    const domainOnly = await DomainIntersectionService.getIntersection(
      { ...input, scope: "domain" },
      customer,
    );
    expect(domainOnly.rows[0]?.aiState).toBe("named_only");

    const withSubs = await DomainIntersectionService.getIntersection(
      { ...input, scope: "subdomains" },
      customer,
    );
    expect(withSubs.rows[0]?.aiState).toBe("cited");
  });

  it("does not compare a query when no organic reading exists", async () => {
    vi.mocked(getStoredKeywordSample).mockResolvedValue(null);
    const result = await DomainIntersectionService.getIntersection(
      input,
      customer,
    );

    expect(result.rows[0]).toMatchObject({
      organic: null,
      organicState: "no_capture",
      comparable: false,
      gap: null,
    });
    expect(result.counts.withoutOrganic).toBe(1);
  });

  it("ignores tracked ranks for a domain that is not the project's own", async () => {
    await DomainIntersectionService.getIntersection(
      { ...input, projectDomain: "mine.com" },
      customer,
    );
    expect(
      DomainIntersectionRepository.latestTrackedRanks,
    ).not.toHaveBeenCalled();
  });
});
