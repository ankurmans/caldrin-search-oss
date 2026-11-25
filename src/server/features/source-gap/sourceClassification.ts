import type { SourceType } from "@/shared/source-gap";
import { sourceKind } from "@/server/features/citation-gaps/citationSourceRules";

const COMMUNITY =
  /(^|\.)(reddit|quora|news\.ycombinator|stackexchange|stackoverflow|discord|forum|community)\./i;
const COMMUNITY_HOSTS =
  /^(reddit\.com|quora\.com|news\.ycombinator\.com|stackoverflow\.com|discourse\.|forum\.)/i;
const PLATFORM =
  /(^|\.)(youtube|youtu\.be|x|twitter|linkedin|facebook|instagram|tiktok|medium|substack|wikipedia|github|apps\.apple|play\.google|chromewebstore\.google|producthunt)\.(com|org|be|co)$/i;
const REVIEW_HOSTS =
  /(^|\.)(g2|capterra|trustpilot|getapp|softwareadvice|softwarereviews|trustradius|sourceforge|alternativeto|slashdot)\.(com|net|org|io)$/i;
const DOCS_HOST = /^(docs?|help|support|developers?|learn|kb|api)\./i;
const DOCS_PATH = /\/(docs?|help|support|developers?|kb|api-reference)\//i;
const ROUNDUP =
  /\b(best|top \d+|top ten|alternatives?|vs\.?|versus|compared?|comparison|reviews?|roundup|ranked)\b/i;

/**
 * What kind of site a cited page is on. Ownership comes from the tracked
 * brands; the rest is read from the address and the title the answer showed,
 * and anything that does not read clearly is "unknown" rather than guessed.
 */
export function classifySource(
  source: { url: string; domain: string; title: string | null },
  brands: { domain: string; name: string; own: boolean }[],
): { type: SourceType; brandName: string | null } {
  const owner = sourceKind(source.domain, brands);
  if (owner.kind === "own") return { type: "own", brandName: owner.brandName };
  if (owner.kind === "competitor")
    return { type: "competitor_owned", brandName: owner.brandName };
  const host = source.domain.toLowerCase().replace(/^www\./, "");
  let path = "";
  try {
    path = new URL(source.url).pathname;
  } catch {
    // Path stays empty.
  }
  if (COMMUNITY.test(host) || COMMUNITY_HOSTS.test(host))
    return { type: "community", brandName: null };
  if (REVIEW_HOSTS.test(host))
    return { type: "review_roundup", brandName: null };
  if (PLATFORM.test(host)) return { type: "platform", brandName: null };
  if (DOCS_HOST.test(host) || DOCS_PATH.test(path))
    return { type: "documentation", brandName: null };
  if (ROUNDUP.test(`${path} ${source.title ?? ""}`))
    return { type: "review_roundup", brandName: null };
  if (path.split("/").filter(Boolean).length >= 1)
    return { type: "editorial", brandName: null };
  return { type: "unknown", brandName: null };
}

export function isThirdParty(type: SourceType): boolean {
  return (
    type === "editorial" ||
    type === "review_roundup" ||
    type === "community" ||
    type === "platform" ||
    type === "unknown"
  );
}
