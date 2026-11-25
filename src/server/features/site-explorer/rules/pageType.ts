export type PageType =
  | "homepage"
  | "article"
  | "collection"
  | "product"
  | "service"
  | "pricing"
  | "comparison"
  | "tool"
  | "other";

// A guess from the URL alone, shown as "likely": nothing was fetched from the
// page. Order matters: comparison and pricing paths are checked first because
// they often sit under /blog or /products.
export function likelyPageType(url: string | null): PageType | null {
  if (!url) return null;
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return null;
  }
  if (path === "" || path === "/") return "homepage";
  if (/(^|\/)(vs|compare|comparison|alternatives?)(\/|$)|-vs-/.test(path)) {
    return "comparison";
  }
  if (/(^|\/)pricing(\/|$)/.test(path)) return "pricing";
  if (/(^|\/)(collections?|categor(y|ies)|shop|c)(\/|$)/.test(path)) {
    return "collection";
  }
  if (/(^|\/)(products?|p|item|items)(\/|$)/.test(path)) return "product";
  if (/(^|\/)(services?|solutions?|features?)(\/|$)/.test(path)) {
    return "service";
  }
  if (/(^|\/)(tools?|calculators?|generators?)(\/|$)/.test(path)) return "tool";
  if (
    /(^|\/)(blog|guides?|learn|articles?|news|resources|how-to|help|posts?)(\/|$)/.test(
      path,
    )
  ) {
    return "article";
  }
  return "other";
}
