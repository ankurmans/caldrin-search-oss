import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCached } from "@/server/lib/r2-cache";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import { DomainService } from "./DomainService";

vi.mock("cloudflare:workers", () => ({ env: {}, waitUntil: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/server/lib/r2-cache", () => ({
  buildCacheKey: vi.fn(async (name: string) => name),
  getCached: vi.fn(),
  setCached: vi.fn(),
}));
vi.mock("@/server/lib/dataforseo", () => ({
  createDataforseoClient: vi.fn(),
}));

const customer = {
  organizationId: "org",
  userId: "u1",
  userEmail: "u@e.com",
};
const input = {
  projectId: "p1",
  domain: "https://www.example.com/",
  locationCode: 2840,
  languageCode: "en",
};

describe("stored domain reads", () => {
  beforeEach(() => {
    vi.mocked(getCached).mockResolvedValue(null);
  });

  it("return null on a cache miss without touching the provider", async () => {
    expect(await DomainService.getStoredOverview(input, customer)).toBeNull();
    expect(await DomainService.getStoredHistory(input, customer)).toBeNull();
    expect(createDataforseoClient).not.toHaveBeenCalled();
  });

  it("serve a cached history without touching the provider", async () => {
    vi.mocked(getCached).mockResolvedValue({
      domain: "example.com",
      months: [],
      fetchedAt: "2026-11-20T00:00:00.000Z",
    });

    expect(await DomainService.getStoredHistory(input, customer)).toMatchObject(
      { domain: "example.com" },
    );
    expect(createDataforseoClient).not.toHaveBeenCalled();
  });
});
