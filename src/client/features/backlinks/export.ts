import type { CsvValue } from "@/client/lib/csv";
import type {
  BacklinksSearchState,
  BacklinksTabRows,
} from "./backlinksPageTypes";

/** Builds the export table for the active tab, matching the on-screen table. */
export function buildBacklinksTabExport(args: {
  tab: BacklinksSearchState["tab"];
  rows: BacklinksTabRows;
}): { headers: string[]; rows: CsvValue[][] } {
  const { tab, rows } = args;

  if (tab === "backlinks") {
    return {
      headers: [
        "Domain",
        "Source URL",
        "Target URL",
        "Anchor",
        "Type",
        "Dofollow",
        "Rel Attributes",
        "Domain Rank",
        "Source Page Rank",
        "Target Rank",
        "Spam Score",
        "First Seen",
        "Last Seen",
        "Lost",
        "Broken",
        "Links Count",
        "Lost Date",
        "Previous Seen",
        "Page Title",
        "Page Language",
        "Platform",
        "Text Before",
        "Text After",
        "Placement",
        "Target Status",
        "Target Redirect",
      ],
      rows: rows.backlinks.map((row) => [
        row.domainFrom,
        row.urlFrom,
        row.urlTo,
        row.anchor,
        row.itemType,
        row.isDofollow,
        row.relAttributes.join(", "),
        row.domainFromRank,
        row.pageFromRank,
        row.rank,
        row.spamScore,
        row.firstSeen,
        row.lastSeen,
        row.isLost,
        row.isBroken,
        row.linksCount,
        row.lostDate,
        row.prevSeen,
        row.pageTitle,
        row.pageLanguage,
        row.platformTypes.join(", "),
        row.textBefore,
        row.textAfter,
        row.semanticLocation,
        row.targetStatusCode,
        row.targetRedirect,
      ]),
    };
  }

  if (tab === "domains") {
    return {
      headers: [
        "Domain",
        "Backlinks",
        "Referring Pages",
        "Domain Rank",
        "Spam Score",
        "First Seen",
        "Broken Backlinks",
        "Broken Pages",
      ],
      rows: rows.referringDomains.map((row) => [
        row.domain,
        row.backlinks,
        row.referringPages,
        row.rank,
        row.spamScore,
        row.firstSeen,
        row.brokenBacklinks,
        row.brokenPages,
      ]),
    };
  }

  return {
    headers: [
      "Page",
      "Backlinks",
      "Referring Domains",
      "Rank",
      "Broken Backlinks",
    ],
    rows: rows.topPages.map((row) => [
      row.page,
      row.backlinks,
      row.referringDomains,
      row.rank,
      row.brokenBacklinks,
    ]),
  };
}

export function buildBacklinksTabFilename(
  tab: BacklinksSearchState["tab"],
  target: string,
) {
  const tabPrefix =
    tab === "backlinks"
      ? "backlinks"
      : tab === "domains"
        ? "referring-domains"
        : "top-pages";
  const normalizedTarget = target
    .toLowerCase()
    .trim()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return `backlinks-${tabPrefix}${normalizedTarget ? `-${normalizedTarget}` : ""}`;
}
