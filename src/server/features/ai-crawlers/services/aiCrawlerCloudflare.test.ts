import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiCrawlerRepository as repo } from "../repositories/AiCrawlerRepository";
import { syncCloudflareCrawlerHits } from "./aiCrawlerCloudflare";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/lib/secret-box", () => ({
  openSecret: async () => "token",
  sealSecret: async (value: string) => value,
}));
vi.mock("../repositories/AiCrawlerRepository", () => ({
  AiCrawlerRepository: {
    getCloudflare: vi.fn(),
    replaceDay: vi.fn(),
    markCloudflareSync: vi.fn(),
    getProjectDomain: vi.fn(),
  },
}));

const group = (
  userAgent: string,
  path: string,
  status: number,
  count: number,
) => ({
  count,
  dimensions: {
    userAgent,
    clientRequestPath: path,
    edgeResponseStatus: status,
  },
});

beforeEach(() => {
  vi.mocked(repo.getProjectDomain).mockResolvedValue("pepys.co");
  vi.mocked(repo.getCloudflare).mockResolvedValue({
    projectId: "p",
    sealedToken: "sealed",
    zoneId: "zone",
    zoneName: "pepys.co",
    createdAt: "",
    lastSyncedAt: null,
    lastError: null,
  });
});

describe("Cloudflare crawler sync", () => {
  it("stores only AI crawler hits, without query strings, replacing each day", async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) =>
      Response.json({
        data: {
          viewer: {
            zones: [
              {
                httpRequestsAdaptiveGroups: [
                  group(
                    "Mozilla/5.0 (compatible; GPTBot/1.2)",
                    "/a?x=1",
                    200,
                    4,
                  ),
                  group("Mozilla/5.0 (compatible; GPTBot/1.2)", "/a", 200, 2),
                  group("Mozilla/5.0 (Macintosh) Safari", "/a", 200, 50),
                  group("ClaudeBot/1.0", "/missing", 404, 1),
                ],
              },
            ],
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncCloudflareCrawlerHits("p", 1);

    expect(result).toEqual({ synced: true, error: null });
    // Only the site's own host: a zone also carries subdomains such as docs.
    const { body: sent } = z
      .object({ body: z.string() })
      .parse(fetchMock.mock.calls[0]?.[1]);
    expect(sent).toContain('clientRequestHTTPHost:\\"pepys.co\\"');
    expect(sent).toContain('clientRequestHTTPHost:\\"www.pepys.co\\"');
    expect(repo.replaceDay).toHaveBeenCalledTimes(1);
    const rows = vi.mocked(repo.replaceDay).mock.calls[0]?.[2];
    expect(rows).toEqual(
      expect.arrayContaining([
        { bot: "GPTBot", path: "/a", statusClass: 2, hits: 6 },
        { bot: "ClaudeBot", path: "/missing", statusClass: 4, hits: 1 },
      ]),
    );
    expect(rows).toHaveLength(2);
  });

  it("keeps the old counts and records the reason when Cloudflare refuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ data: null, errors: [{ message: "not authorized" }] }),
      ),
    );

    const result = await syncCloudflareCrawlerHits("p", 1);

    expect(result).toEqual({ synced: false, error: "not authorized" });
    expect(repo.replaceDay).not.toHaveBeenCalled();
    expect(repo.markCloudflareSync).toHaveBeenCalledWith("p", {
      at: expect.any(String) as unknown,
      error: "not authorized",
    });
  });
});
