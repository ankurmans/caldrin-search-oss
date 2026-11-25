import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverSiteUrls, readPages, readSite } from "@/server/lib/scrape";

vi.mock("@/server/lib/runtime-env", () => ({
  getOptionalEnvValue: async (name: string) =>
    name === "TINYFISH_API_KEY" ? "tinyfish-test-key" : undefined,
}));

describe("readSite SSRF guard", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(["169.254.169.254", "localhost:3000"])(
    "blocks %s without fetching it",
    async (host) => {
      const result = await readSite(host);

      expect(result.blocked).toBe(true);
      expect(result.pages).toEqual([]);
      // The blocked host must be rejected before any outbound page fetch.
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});

describe("readPages SSRF guard", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips private/metadata URLs without fetching them", async () => {
    const result = await readPages([
      "http://169.254.169.254/latest/meta-data/",
      "http://localhost:3000/admin",
    ]);

    expect(result.blocked).toBe(true);
    expect(result.pages).toEqual([]);
    // Every URL is validated before any outbound fetch.
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("readSite", () => {
  // Unlisted URLs (sitemaps, DoH lookups) 404; a missing route value throws
  // like a failed TLS handshake.
  function stubSite(routes: Record<string, string | null>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (!(url in routes)) return new Response(null, { status: 404 });
        const target = routes[url];
        if (target === null) throw new TypeError("fetch failed");
        return target.startsWith("http")
          ? new Response(null, { status: 302, headers: { location: target } })
          : new Response(target);
      }),
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("follows a multi-hop redirect chain to the homepage", async () => {
    stubSite({
      "https://example.com/": "http://www.example.com/",
      "http://www.example.com/": "https://www.example.com/",
      "https://www.example.com/": "Example homepage",
    });

    const result = await readSite("example.com");

    expect(result.pages.map((page) => page.text)).toEqual(["Example homepage"]);
  });

  it("falls back to www when the bare domain can't be read", async () => {
    stubSite({
      "https://example.com/": null,
      "https://www.example.com/": "Example homepage",
    });

    const result = await readSite("example.com");

    expect(result.pages.map((page) => page.url)).toEqual([
      "https://www.example.com/",
    ]);
  });

  it("does not retry an unreadable IP address on www", async () => {
    stubSite({ "https://93.184.216.34/": null });

    const result = await readSite("93.184.216.34");

    expect(result.blocked).toBe(true);
  });
});

const loc = (...urls: string[]) =>
  `<urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`;

describe("discoverSiteUrls", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubSite(routes: Record<string, string>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url in routes
          ? new Response(routes[url])
          : new Response(null, { status: 404 }),
      ),
    );
  }

  it("lists the pages inside every file of a sitemap index, not just the index", async () => {
    stubSite({
      "https://example.com/sitemap.xml": `<sitemapindex><sitemap><loc>https://example.com/sitemaps/core.xml</loc></sitemap><sitemap><loc>https://example.com/sitemaps/resources.xml</loc></sitemap></sitemapindex>`,
      "https://example.com/sitemaps/core.xml": loc(
        "https://example.com/pricing",
      ),
      "https://example.com/sitemaps/resources.xml": loc(
        "https://example.com/best/pay-as-you-go-transcription",
        "https://example.com/pricing",
      ),
    });

    const { urls } = await discoverSiteUrls("example.com", 50);

    expect(urls).toEqual([
      "https://example.com/",
      "https://example.com/pricing",
      "https://example.com/best/pay-as-you-go-transcription",
    ]);
  });

  it("finds a sitemap that only robots.txt names", async () => {
    stubSite({
      "https://example.com/robots.txt":
        "User-agent: *\nSitemap: https://example.com/maps/all.xml",
      "https://example.com/maps/all.xml": loc("https://example.com/pricing"),
    });

    const { urls } = await discoverSiteUrls("example.com", 50);

    expect(urls).toContain("https://example.com/pricing");
  });
});

describe("readPages text", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the article rather than a long menu that comes before it", async () => {
    const menu = Array.from({ length: 300 }, (_, i) => `<a>Menu ${i}</a>`);
    const html = `<nav>${menu.join("")}</nav><article><h1>Best dictation apps</h1><p>${"Real article text. ".repeat(40)}</p></article>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.startsWith("https://dns")
          ? new Response(null, { status: 404 })
          : new Response(html),
      ),
    );

    const result = await readPages(["https://blog.example.com/best"], 1);

    expect(result.pages[0]?.text.startsWith("Best dictation apps")).toBe(true);
    expect(result.pages[0]?.text).not.toContain("Menu 1");
  });
});

describe("readSite with TinyFish rendering", () => {
  // The homepage is blocked, /internal redirects to a private host, and other
  // URLs are missing; TinyFish renders pages.
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("dns-query"))
          return Response.json({
            Status: 0,
            Answer: [{ type: 1, data: "93.184.216.34" }],
          });
        if (url.startsWith("https://api.fetch.tinyfish.ai"))
          return Response.json({
            results: [
              {
                url: "https://store.example.com/",
                final_url: "https://store.example.com/",
                text: "<title>Store</title><p>Linen sheets</p>",
                format: "html",
              },
            ],
          });
        if (url === "https://store.example.com/")
          return new Response(null, { status: 403 });
        if (url === "https://store.example.com/internal")
          return new Response(null, {
            status: 302,
            headers: { location: "http://169.254.169.254/" },
          });
        return new Response(null, { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads a blocked page through TinyFish at no credit cost", async () => {
    const usage = { cloudflareAttempts: 0, tinyfishCredits: 0 };

    const result = await readSite("store.example.com", 3, usage);

    expect(result.pages).toEqual([
      {
        url: "https://store.example.com/",
        title: "Store",
        text: "Store Linen sheets",
      },
    ]);
    expect(usage.tinyfishCredits).toBe(0);
  });

  it("does not spend TinyFish credits on a missing page", async () => {
    const usage = { cloudflareAttempts: 0, tinyfishCredits: 0 };

    await readPages(["https://store.example.com/missing"], 1, usage);

    expect(usage.tinyfishCredits).toBe(0);
  });

  it("does not send a redirect to a blocked host to TinyFish", async () => {
    const usage = { cloudflareAttempts: 0, tinyfishCredits: 0 };

    await readPages(["https://store.example.com/internal"], 1, usage);

    expect(usage.tinyfishCredits).toBe(0);
  });
});
