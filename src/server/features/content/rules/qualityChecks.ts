import { sanitizeHtml } from "./sanitizeHtml";
import { tokenize } from "./opportunityRules";
import type { DraftContent } from "./templateDraft";
import type { StoreSnapshot } from "./storeTypes";

export type QualityCheck = {
  key: string;
  severity: "block" | "warn";
  passed: boolean;
  detail: string;
};

const PLACEHOLDER = /\[(?:MERCHANT TO ADD|TODO|TBD)[^\]]*\]/gi;
const UNSOURCED_CLAIMS =
  /\b\d+(?:\.\d+)?\s?%|\b(?:studies show|study found|research shows|survey(?:s)? (?:found|show)|according to|experts? (?:say|agree)|clinically|scientifically proven|guaranteed?)\b/gi;
const FABRICATED_EXPERIENCE =
  /\b(?:we tested|i tested|our testing|our team tested|in our experience|customers? (?:say|love|report)|reviews? (?:say|show)|rated \d)/gi;

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1] ?? "");
}

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

export const DUPLICATE_INTENT_JACCARD = 0.6;

export function runQualityChecks(
  draft: DraftContent,
  store: StoreSnapshot,
  verifyStoreLinks = true,
): QualityCheck[] {
  const text = textOf(draft.bodyHtml);
  const checks: QualityCheck[] = [];

  checks.push({
    key: "safe_markup",
    severity: "block",
    passed: sanitizeHtml(draft.bodyHtml) === draft.bodyHtml,
    detail:
      sanitizeHtml(draft.bodyHtml) === draft.bodyHtml
        ? "Only plain article markup is used."
        : "The body contains scripts, unsupported tags or unsafe links. Save the draft again to remove them.",
  });

  checks.push({
    key: "body_has_content",
    severity: "block",
    passed: text.length > 0,
    detail:
      text.length > 0
        ? "Draft has body copy."
        : "Add body copy before approval.",
  });

  const placeholders = text.match(PLACEHOLDER) ?? [];
  checks.push({
    key: "no_unresolved_placeholders",
    severity: "block",
    passed: placeholders.length === 0,
    detail:
      placeholders.length === 0
        ? "No placeholders remain."
        : `${placeholders.length} placeholder(s) still need merchant facts: ${placeholders.slice(0, 3).join(" ")}`,
  });

  const claims = text.match(UNSOURCED_CLAIMS) ?? [];
  checks.push({
    key: "no_unsourced_claims",
    severity: "block",
    passed: claims.length === 0,
    detail:
      claims.length === 0
        ? "No percentages or research claims found."
        : `Statistics or research claims with no supplied source: ${claims.slice(0, 5).join(", ")}`,
  });

  const experience = text.match(FABRICATED_EXPERIENCE) ?? [];
  checks.push({
    key: "no_fabricated_experience",
    severity: "block",
    passed: experience.length === 0,
    detail:
      experience.length === 0
        ? "No first-hand testing or customer claims found."
        : `Claims of testing or customer feedback that the system has no data for: ${experience.slice(0, 5).join(", ")}`,
  });

  const known = new Set<string>([
    ...store.products.map((p) => `/products/${p.handle}`),
    ...store.collections.map((c) => `/collections/${c.handle}`),
    ...store.articles.map((a) => `/blogs/${a.blogHandle}/${a.handle}`),
  ]);
  const internal = hrefs(draft.bodyHtml).filter((h) => h.startsWith("/"));
  const unknownLinks = verifyStoreLinks
    ? internal.filter((h) => !known.has(h))
    : [];
  checks.push({
    key: "internal_links_resolve",
    severity: verifyStoreLinks ? "block" : "warn",
    passed: verifyStoreLinks && unknownLinks.length === 0,
    detail: !verifyStoreLinks
      ? "Internal destinations need editorial review."
      : unknownLinks.length === 0
        ? `${internal.length} internal link(s), all exist in the store.`
        : `Links to pages not found in the store: ${unknownLinks.join(", ")}`,
  });

  const unavailable = internal
    .map((h) => store.products.find((p) => `/products/${p.handle}` === h))
    .filter((p) => p !== undefined && !p.available);
  checks.push({
    key: "products_available",
    severity: "block",
    passed: unavailable.length === 0,
    detail:
      unavailable.length === 0
        ? "Every linked product is available."
        : `Linked products currently unavailable: ${unavailable.map((p) => p?.title).join(", ")}`,
  });

  const finalParagraph = /<p>(?:(?!<p>)[\s\S])*<\/p>\s*$/i.exec(
    draft.bodyHtml,
  )?.[0];
  const hasCta = finalParagraph ? hrefs(finalParagraph).length > 0 : false;
  checks.push({
    key: "has_internal_links",
    severity: "warn",
    passed: internal.length >= 2,
    detail: `${internal.length} internal link(s); two or more help readers move on and help search engines find related pages.`,
  });
  checks.push({
    key: "has_image",
    severity: "warn",
    passed: /<img\s/i.test(draft.bodyHtml),
    detail: /<img\s/i.test(draft.bodyHtml)
      ? "The article has an image."
      : "The article has no image; add a product photo.",
  });
  checks.push({
    key: "has_call_to_action",
    severity: "warn",
    passed: hasCta,
    detail: hasCta
      ? "The article ends with a link to a product or page."
      : "The last paragraph has no link; end with a call to action.",
  });

  const h2s = (draft.bodyHtml.match(/<h2[ >]/gi) ?? []).length;
  checks.push({
    key: "has_section_structure",
    severity: "warn",
    passed: h2s >= 2,
    detail: `${h2s} section heading(s); two or more help readers and crawlers scan the page.`,
  });

  checks.push({
    key: "title_length",
    severity: "warn",
    passed: draft.title.length >= 15 && draft.title.length <= 70,
    detail: `Title is ${draft.title.length} characters (15 to 70 reads cleanly).`,
  });
  checks.push({
    key: "meta_title_length",
    severity: "warn",
    passed: draft.metaTitle.length <= 60,
    detail: `Meta title is ${draft.metaTitle.length} characters (60 or fewer avoids truncation).`,
  });
  checks.push({
    key: "meta_description_length",
    severity: "warn",
    passed:
      draft.metaDescription.length >= 70 && draft.metaDescription.length <= 160,
    detail: `Meta description is ${draft.metaDescription.length} characters (70 to 160).`,
  });

  const titleTokens = tokenize(draft.title);
  const overlapping = store.articles.find(
    (a) => jaccard(titleTokens, tokenize(a.title)) >= DUPLICATE_INTENT_JACCARD,
  );
  checks.push({
    key: "duplicate_intent",
    severity: "warn",
    passed: !overlapping,
    detail: overlapping
      ? `Title overlaps the existing article "${overlapping.title}". Consider refreshing it instead.`
      : "No existing article has a closely matching title.",
  });

  return checks;
}

export function hasBlockingFailure(checks: QualityCheck[]): boolean {
  return checks.some((c) => c.severity === "block" && !c.passed);
}
