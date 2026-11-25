export const SITE_PLATFORMS = [
  "wordpress",
  "shopify",
  "webflow",
  "framer",
  "squarespace",
  "wix",
  "repository",
  "unknown",
] as const;

export type SitePlatform = (typeof SITE_PLATFORMS)[number];

export const SITE_PLATFORM_LABELS: Record<SitePlatform, string> = {
  wordpress: "WordPress",
  shopify: "Shopify",
  webflow: "Webflow",
  framer: "Framer",
  squarespace: "Squarespace",
  wix: "Wix",
  repository: "Repository-backed site",
  unknown: "Unknown or other",
};
