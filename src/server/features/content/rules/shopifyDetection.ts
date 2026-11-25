const HTML_MARKERS = ["cdn.shopify.com", "Shopify.shop", "/cdn/shop/"] as const;
const HEADER_MARKERS = ["x-shopid", "x-shopify-stage"] as const;

/**
 * The first Shopify marker in a homepage response, or null when there is none.
 * Headers are checked first because they survive a theme that hides its assets.
 */
export function findShopifyMarker(
  headers: Pick<Headers, "has">,
  html: string,
): string | null {
  for (const name of HEADER_MARKERS) {
    if (headers.has(name)) return `${name} header`;
  }
  return HTML_MARKERS.find((marker) => html.includes(marker)) ?? null;
}

/** Shopify UI shows for a connected store, a person's say-so, or a detection. */
export function showsShopify(input: {
  connected: boolean;
  manualShopify: boolean;
  detection: "shopify" | "not_shopify" | "unknown" | null;
}): boolean {
  return (
    input.connected || input.manualShopify || input.detection === "shopify"
  );
}
