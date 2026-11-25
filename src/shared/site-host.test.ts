import { describe, expect, it } from "vitest";
import {
  detectSiteHost,
  detectSitePlatform,
  isCloudflareIp,
} from "./site-host";

const host = (headers: Record<string, string>, proxied: boolean | null) =>
  detectSiteHost(new Headers(headers), proxied);

describe("isCloudflareIp", () => {
  it("matches Cloudflare's proxy ranges only", () => {
    expect(isCloudflareIp("104.21.5.9")).toBe(true);
    expect(isCloudflareIp("172.67.1.1")).toBe(true);
    expect(isCloudflareIp("216.198.79.1")).toBe(false);
    expect(isCloudflareIp("76.76.21.21")).toBe(false);
  });
});

describe("detectSiteHost", () => {
  it("calls a DNS-only domain Vercel even though a Worker sees Cloudflare headers", () => {
    expect(
      host(
        { server: "cloudflare", "cf-ray": "abc", "x-vercel-id": "cdg1::abc" },
        false,
      ),
    ).toBe("vercel");
  });

  it("prefers the customer's proxied Cloudflare over the origin behind it", () => {
    expect(host({ "x-vercel-id": "cdg1::abc" }, true)).toBe("cloudflare");
  });

  it("does not offer Cloudflare to a Shopify store, whose Cloudflare is Shopify's", () => {
    expect(host({ "powered-by": "Shopify", server: "cloudflare" }, true)).toBe(
      "shopify",
    );
  });

  it("recognises WordPress from its REST link header", () => {
    expect(
      host(
        { link: '<https://x.com/wp-json/>; rel="https://api.w.org/"' },
        false,
      ),
    ).toBe("wordpress");
  });

  it("falls back to the headers when DNS cannot be read", () => {
    expect(host({ server: "cloudflare" }, null)).toBe("cloudflare");
    expect(host({ server: "cloudflare", "x-vercel-id": "x" }, null)).toBe(
      "vercel",
    );
  });

  it("returns unknown when nothing identifies the host", () => {
    expect(host({ server: "nginx" }, false)).toBe("unknown");
  });
});

describe("detectSitePlatform", () => {
  it("keeps WordPress separate from a Cloudflare host", () => {
    const headers = new Headers({
      link: '<https://example.com/wp-json/>; rel="https://api.w.org/"',
    });
    expect(detectSiteHost(headers, true)).toBe("cloudflare");
    expect(detectSitePlatform(headers).declared?.platform).toBe("wordpress");
  });

  it.each([
    ['<meta content="Framer" name="generator">', "declared", "framer"],
    ['<html data-wf-site="site-id">', "markup", "webflow"],
    ['<script src="//cdn.shopify.com/shop.js"></script>', "markup", "shopify"],
    [
      '<script src="/_next/static/entry.js"></script>',
      "framework",
      "repository",
    ],
  ] as const)("detects %s as %s evidence", (html, evidence, platform) => {
    expect(detectSitePlatform(new Headers(), html)[evidence]?.platform).toBe(
      platform,
    );
  });

  it("ignores platform names in page copy and hosting headers", () => {
    expect(
      detectSitePlatform(
        new Headers({ server: "Vercel" }),
        "<p>Built with Wix or Framer?</p>",
      ),
    ).toEqual({
      declared: null,
      markup: null,
      framework: null,
    });
  });
});
