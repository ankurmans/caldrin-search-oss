import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainService } from "@/server/features/domain/services/DomainService";
import { DomainMarketsService } from "./domainMarkets";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/server/features/domain/services/DomainService", () => ({
  DomainService: { getStoredOverview: vi.fn(), getOverview: vi.fn() },
}));

const customer = {
  organizationId: "org-cloud",
  userId: "u1",
  userEmail: "u@e.com",
};
const US = 2840;
const UK = 2826;
const input = {
  projectId: "p1",
  domain: "https://www.example.com/x",
  locationCodes: [US, UK],
};

describe("DomainMarketsService", () => {
  beforeEach(() => {
    vi.mocked(DomainService.getStoredOverview).mockResolvedValue(null);
  });

  it("prices only the markets that are not already stored, and reads nothing", async () => {
    vi.mocked(DomainService.getStoredOverview).mockImplementation(
      async (request) =>
        request.locationCode === US
          ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only presence of a stored overview matters
            ({} as NonNullable<
              Awaited<ReturnType<typeof DomainService.getStoredOverview>>
            >)
          : null,
    );
    const plan = await DomainMarketsService.planMarkets(input, customer);

    expect(plan.domain).toBe("example.com");
    expect(plan.markets).toMatchObject([
      { locationCode: US, cached: true, estimateUsd: 0 },
      { locationCode: UK, cached: false },
    ]);
    expect(plan.markets[1].estimateUsd).toBeGreaterThan(0);
    expect(plan.totalUsd).toBe(plan.markets[1].estimateUsd);
    expect(DomainService.getOverview).not.toHaveBeenCalled();
  });

  it("keeps the other markets when one read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(DomainService.getOverview).mockImplementation(async (request) => {
      if (request.locationCode === UK) throw new Error("provider down");
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- partial fixture: only the fields the row reports
      return {
        hasData: true,
        organicKeywords: 12,
        organicTraffic: 340,
        fetchedAt: "2026-11-20T00:00:00.000Z",
      } as Awaited<ReturnType<typeof DomainService.getOverview>>;
    });
    const { rows } = await DomainMarketsService.readMarkets(input, customer);

    expect(rows).toMatchObject([
      { locationCode: US, status: "ok", organicKeywords: 12 },
      { locationCode: UK, status: "error" },
    ]);
  });
});
