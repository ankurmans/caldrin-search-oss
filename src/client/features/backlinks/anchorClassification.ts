export type AnchorKind = "branded" | "url" | "generic" | "other" | "empty";

const GENERIC = new Set([
  "click here",
  "here",
  "this",
  "this link",
  "link",
  "read more",
  "learn more",
  "more",
  "website",
  "site",
  "visit",
  "visit website",
  "source",
  "homepage",
]);

function compact(value: string) {
  return value.replace(/[^a-z0-9]/g, "");
}

function brandToken(host: string) {
  const label = host
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".")[0];
  return compact(label);
}

/**
 * A rough label for an anchor, from its text alone. It reads the domain's
 * first label as the brand, so a company named differently from its domain
 * is under-counted as branded. A heuristic, never a judgment of the link.
 */
export function classifyAnchor(
  anchor: string | null | undefined,
  targetHost: string,
): AnchorKind {
  const text = anchor?.trim().toLowerCase();
  if (!text) return "empty";
  if (
    /^(https?:\/\/|www\.)/.test(text) ||
    /^[a-z0-9-]+(\.[a-z0-9-]+)+\/?$/.test(text)
  )
    return "url";
  const brand = brandToken(targetHost);
  if (brand.length >= 3 && compact(text).includes(brand)) return "branded";
  if (GENERIC.has(text)) return "generic";
  return "other";
}
