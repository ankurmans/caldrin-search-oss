import { beforeEach, describe, expect, it, vi } from "vitest";
import { GscNotConnectedError } from "@/server/lib/gscErrors";
import { Ga4ReportError } from "@/server/lib/ga4Errors";
import { OpportunityRepository } from "@/server/features/opportunities/repositories/OpportunityRepository";
import { GscService } from "@/server/features/gsc/services/GscService";
import { Ga4OrganicOverviewService } from "@/server/features/ga4/services/Ga4OrganicOverviewService";
import { DomainFirstPartyService } from "./domainFirstParty";

vi.mock("cloudflare:workers", () => ({ env: {} }));
// The service reads the database only through the mocked repositories.
vi.mock("@/db", () => ({ db: {} }));
vi.mock(
  "@/server/features/opportunities/repositories/OpportunityRepository",
  () => ({
    OpportunityRepository: { getProjectBrand: vi.fn() },
  }),
);
vi.mock("@/server/features/gsc/services/GscService", async () => ({
  GscNotConnectedError: (await import("@/server/lib/gscErrors"))
    .GscNotConnectedError,
  isExpectedGrantFailure: () => false,
  GscService: { getPerformance: vi.fn() },
}));
vi.mock("@/server/features/ga4/services/Ga4OrganicOverviewService", () => ({
  Ga4OrganicOverviewService: { getOrganicOverview: vi.fn() },
}));

const input = { projectId: "p1", domain: "example.com" };

describe("DomainFirstPartyService", () => {
  beforeEach(() => {
    vi.mocked(OpportunityRepository.getProjectBrand).mockResolvedValue({
      name: "Example",
      brandName: "Example",
      domain: "https://www.example.com/",
      locationCode: 2840,
      languageCode: "en",
    });
  });

  it("returns nothing for a domain the project does not own", async () => {
    const result = await DomainFirstPartyService.getSearchConsole({
      ...input,
      domain: "rival.com",
    });
    expect(result).toEqual({ status: "not_own_domain" });
    expect(GscService.getPerformance).not.toHaveBeenCalled();
  });

  it("reports a source that is not connected without failing the others", async () => {
    vi.mocked(GscService.getPerformance).mockRejectedValue(
      new GscNotConnectedError("p1"),
    );
    vi.mocked(Ga4OrganicOverviewService.getOrganicOverview).mockRejectedValue(
      new Ga4ReportError("ga4_not_connected", "not connected"),
    );
    await expect(
      DomainFirstPartyService.getSearchConsole(input),
    ).resolves.toEqual({ status: "not_connected" });
    await expect(DomainFirstPartyService.getAnalytics(input)).resolves.toEqual({
      status: "not_connected",
    });
  });

  it("keeps branded and non-branded totals apart from the all-query total", async () => {
    vi.mocked(GscService.getPerformance).mockImplementation(async (request) => {
      const operator = request.filters?.[0]?.operator;
      const clicks =
        operator === "contains" ? 10 : operator === "notContains" ? 30 : 50;
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- partial fixture: only the fields the totals read
      return {
        siteUrl: "sc-domain:example.com",
        connectedBy: null,
        request: {},
        rows: [
          {
            keys: ["2026-11-01"],
            clicks,
            impressions: clicks * 10,
            ctr: 0.1,
            position: 5,
          },
        ],
      } as Awaited<ReturnType<typeof GscService.getPerformance>>;
    });
    const result = await DomainFirstPartyService.getSearchConsole(input);
    expect(result).toMatchObject({
      status: "ok",
      totals: { clicks: 50 },
      branded: { clicks: 10 },
      nonBranded: { clicks: 30 },
    });
  });
});
