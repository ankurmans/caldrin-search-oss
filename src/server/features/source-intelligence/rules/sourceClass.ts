/**
 * What kind of page a cited or retrieved source is, from its host and title
 * alone. Rules name only platforms whose type is certain; a source that no
 * rule covers is "unknown", never a guess. Tracked brands are set by the
 * caller, so "own" and "competitor" never come from here.
 */
export type SourceClass =
  | "own"
  | "competitor"
  | "community"
  | "video"
  | "social"
  | "code_docs"
  | "review_site"
  | "app_store"
  | "reference"
  | "search_engine"
  | "roundup"
  | "unknown";

export const SOURCE_CLASS_LABELS: Record<SourceClass, string> = {
  own: "Your site",
  competitor: "Competitor",
  community: "Community",
  video: "Video",
  social: "Social",
  code_docs: "Code or documentation",
  review_site: "Review site",
  app_store: "App store",
  reference: "Reference",
  search_engine: "Search engine",
  roundup: "Roundup",
  unknown: "Unknown",
};

const HOSTS: [SourceClass, string[]][] = [
  [
    "community",
    [
      "reddit.com",
      "quora.com",
      "news.ycombinator.com",
      "stackoverflow.com",
      "stackexchange.com",
      "producthunt.com",
      "indiehackers.com",
      "discord.com",
    ],
  ],
  ["video", ["youtube.com", "youtu.be", "vimeo.com", "tiktok.com"]],
  [
    "social",
    ["linkedin.com", "x.com", "twitter.com", "facebook.com", "instagram.com"],
  ],
  ["code_docs", ["github.com", "gitlab.com", "npmjs.com", "readthedocs.io"]],
  [
    "review_site",
    [
      "g2.com",
      "capterra.com",
      "trustpilot.com",
      "softwareadvice.com",
      "getapp.com",
      "trustradius.com",
      "gartner.com",
    ],
  ],
  [
    "app_store",
    [
      "chromewebstore.google.com",
      "chrome.google.com",
      "apps.apple.com",
      "play.google.com",
      "addons.mozilla.org",
      "marketplace.atlassian.com",
    ],
  ],
  ["reference", ["wikipedia.org", "wikidata.org", "britannica.com"]],
  ["search_engine", ["google.com", "bing.com", "duckduckgo.com"]],
];

const ROUNDUP_TITLE =
  /\b(best|top)\b.{0,40}\b(\d+|tools?|apps?|software|alternatives|options|recorders?|platforms?)\b|\b\d+\s+(best|top)\b|\balternatives\b|\bcompared\b|\breviewed\b/i;

function hostMatches(host: string, pattern: string): boolean {
  // A platform's subdomains count (en.wikipedia.org), a longer host does not.
  return host === pattern || host.endsWith(`.${pattern}`);
}

/** Host-only classes win over the title; the title decides roundups only. */
export function classifySource(source: {
  host: string;
  title?: string | null;
  brand?: "own" | "competitor" | null;
}): SourceClass {
  if (source.brand) return source.brand;
  const host = source.host.toLowerCase().replace(/^www\./, "");
  for (const [sourceClass, hosts] of HOSTS)
    if (hosts.some((pattern) => hostMatches(host, pattern))) return sourceClass;
  if (/^(docs|developer|developers|support|help)\./.test(host))
    return "code_docs";
  if (source.title && ROUNDUP_TITLE.test(source.title)) return "roundup";
  return "unknown";
}
