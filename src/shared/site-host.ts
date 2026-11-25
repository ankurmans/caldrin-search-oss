import { Parser } from "htmlparser2";
import { SITE_PLATFORM_LABELS, type SitePlatform } from "./site-platform";

export type SiteHost =
  | "cloudflare"
  | "vercel"
  | "netlify"
  | "wordpress"
  | "shopify"
  | "wix"
  | "squarespace"
  | "unknown";

export const SITE_HOST_LABELS: Record<SiteHost, string> = {
  cloudflare: "Cloudflare",
  vercel: "Vercel",
  netlify: "Netlify",
  wordpress: "WordPress",
  shopify: "Shopify",
  wix: "Wix",
  squarespace: "Squarespace",
  unknown: "an unknown host",
};

/** Site builders that give their customers no request logs and nowhere to run a drain. */
export const CLOSED_HOSTS: readonly SiteHost[] = [
  "shopify",
  "wix",
  "squarespace",
];

// Cloudflare's published proxy ranges (cloudflare.com/ips-v4). An address in
// one of them means the site's DNS record is proxied through Cloudflare.
const CLOUDFLARE_RANGES = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
] as const;

const ipv4ToNumber = (ip: string) =>
  ip.split(".").reduce((total, part) => total * 256 + Number(part), 0);

export function isCloudflareIp(ip: string) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false;
  const value = ipv4ToNumber(ip);
  return CLOUDFLARE_RANGES.some((range) => {
    const [base = "", bits = "0"] = range.split("/");
    const size = 2 ** (32 - Number(bits));
    const start = ipv4ToNumber(base);
    return value >= start && value < start + size;
  });
}

/**
 * Where a site is hosted. `proxied` says whether its DNS points at Cloudflare's
 * proxy, which is the only way Cloudflare sees its visits (null when DNS could
 * not be read). Response headers cannot tell: a Worker gets Cloudflare's
 * headers back even for a domain set to DNS only. Site builders come first
 * because they sit behind their own Cloudflare, which the customer cannot read.
 */
export function detectSiteHost(
  headers: Headers,
  proxied: boolean | null,
): SiteHost {
  const has = (name: string) => headers.has(name);
  const server = (headers.get("server") ?? "").toLowerCase();
  const poweredBy = (headers.get("powered-by") ?? "").toLowerCase();
  if (has("x-shopid") || has("x-shopify-stage") || poweredBy === "shopify")
    return "shopify";
  if (has("x-wix-request-id") || server === "pepyaka") return "wix";
  if (server.includes("squarespace")) return "squarespace";
  if (proxied) return "cloudflare";
  if (has("x-vercel-id") || server === "vercel") return "vercel";
  if (has("x-nf-request-id") || server === "netlify") return "netlify";
  if ((headers.get("link") ?? "").includes("api.w.org")) return "wordpress";
  // DNS unreadable: a Cloudflare answer with no origin behind it is the host.
  return proxied === null && server === "cloudflare" ? "cloudflare" : "unknown";
}

type PlatformMatch = {
  platform: Exclude<SitePlatform, "unknown">;
  evidence: string;
};

const GENERATOR_PLATFORMS = [
  "wordpress",
  "webflow",
  "framer",
  "squarespace",
  "wix",
  "shopify",
] as const;
const found = (
  platform: PlatformMatch["platform"],
  evidence: string,
): PlatformMatch => ({
  platform,
  evidence,
});

export function detectSitePlatform(headers: Headers, html = "") {
  let declared: PlatformMatch | null = null;
  let markup: PlatformMatch | null = null;
  let framework: PlatformMatch | null = null;

  const host = detectSiteHost(headers, false);
  const headerEvidence = {
    shopify: headers.has("x-shopid")
      ? "x-shopid header"
      : headers.has("x-shopify-stage")
        ? "x-shopify-stage header"
        : "Shopify powered-by header",
    wix: headers.has("x-wix-request-id")
      ? "x-wix-request-id header"
      : "Pepyaka server header",
    squarespace: "Squarespace server header",
    wordpress: "WordPress REST API Link header",
  };
  if (host === "shopify" || host === "wix" || host === "squarespace") {
    return { declared: found(host, headerEvidence[host]), markup, framework };
  }
  if ((headers.get("link") ?? "").includes("https://api.w.org/")) {
    return {
      declared: found("wordpress", headerEvidence.wordpress),
      markup,
      framework,
    };
  }
  if (/^next\.js$/i.test(headers.get("x-powered-by") ?? "")) {
    framework = found("repository", "Next.js x-powered-by header");
  }

  new Parser({
    onopentag(tag, attrs) {
      if (tag === "meta" && attrs.name?.toLowerCase() === "generator") {
        const generator = attrs.content?.trim().toLowerCase() ?? "";
        const key = generator.match(/^[a-z.]+/)?.[0]?.replace(/\.com$/, "");
        const platform = GENERATOR_PLATFORMS.find((item) => item === key);
        if (platform)
          declared ??= found(
            platform,
            `${SITE_PLATFORM_LABELS[platform]} generator meta tag`,
          );
        if (
          /^(astro|hugo|next\.js|gatsby|jekyll|eleventy|nuxt)\b/i.test(
            generator,
          )
        )
          framework ??= found("repository", "Framework generator meta tag");
      }

      const asset = attrs.src ?? attrs.href ?? "";
      if (tag === "html" && attrs["data-wf-site"])
        markup ??= found("webflow", "data-wf-site attribute");
      if (
        attrs["data-framer-name"] ||
        /^https?:\/\/framerusercontent\.com\//i.test(asset)
      )
        markup ??= found("framer", "Framer markup or asset");
      if (/^https?:\/\/(?:static1|images)\.squarespace-cdn\.com\//i.test(asset))
        markup ??= found("squarespace", "Squarespace CDN asset");
      if (/^https?:\/\/static\.wixstatic\.com\//i.test(asset))
        markup ??= found("wix", "Wix CDN asset");
      if (/^(?:(?:https?:)?\/\/cdn\.shopify\.com\/|\/cdn\/shop\/)/i.test(asset))
        markup ??= found("shopify", "Shopify CDN asset");
      if (/\/wp-(?:content|includes)\//i.test(asset))
        markup ??= found("wordpress", "WordPress asset path");

      if (attrs.id === "__NEXT_DATA__" || asset.includes("/_next/static/"))
        framework ??= found("repository", "Next.js markup or asset");
      if (tag === "astro-island" || asset.startsWith("/_astro/"))
        framework ??= found("repository", "Astro markup or asset");
      if (attrs.id === "__NUXT_DATA__")
        framework ??= found("repository", "Nuxt markup");
    },
  }).end(html);

  return { declared, markup, framework };
}
