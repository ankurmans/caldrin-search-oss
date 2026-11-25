// A hub is one workspace in the sidebar whose pages are separate routes. The
// bar lists them, so related tools sit one click apart without merging their
// URLs. `segments` are the project route segments the hub covers.
type HubTab = {
  label: string;
  to:
    | "/p/$projectId/keywords"
    | "/p/$projectId/saved"
    | "/p/$projectId/domain"
    | "/p/$projectId/keyword-gap"
    | "/p/$projectId/competitors"
    | "/p/$projectId/brand-lookup"
    | "/p/$projectId/search-performance"
    | "/p/$projectId/rank-tracking"
    | "/p/$projectId/ai-visibility/insights"
    | "/p/$projectId/ai-visibility/perception"
    | "/p/$projectId/ai-visibility"
    | "/p/$projectId/ai-visibility/research"
    | "/p/$projectId/prompt-explorer"
    | "/p/$projectId/ai-visibility/citations"
    | "/p/$projectId/ai-visibility/sources"
    | "/p/$projectId/audit"
    | "/p/$projectId/technical/ai-crawlers"
    | "/p/$projectId/technical/indexing"
    | "/p/$projectId/ai-visibility/claims"
    | "/p/$projectId/ai-visibility/facts"
    | "/p/$projectId/opportunities"
    | "/p/$projectId/content"
    | "/p/$projectId/changes";
  /** Match only this exact path, not the routes below it. */
  exact?: boolean;
  /**
   * Pages grouped under this tab. The tab opens the first one, stays active on
   * any of them, and the bar shows them as a second row.
   */
  views?: readonly Omit<HubTab, "views">[];
};

type Hub = {
  label: string;
  segments: readonly string[];
  tabs: readonly HubTab[];
  /** A hub whose bar has its own component, because its tabs are not plain routes. */
  custom?: "site-explorer";
};

const hubs: readonly Hub[] = [
  {
    label: "Keywords & SERPs",
    segments: ["keywords", "saved"],
    tabs: [
      { label: "Keyword research", to: "/p/$projectId/keywords" },
      { label: "Saved keywords", to: "/p/$projectId/saved" },
    ],
  },
  {
    label: "Site Explorer",
    segments: ["domain", "competitors", "keyword-gap", "brand-lookup"],
    tabs: [],
    custom: "site-explorer",
  },
  {
    label: "Organic Search",
    segments: ["search-performance", "rank-tracking"],
    tabs: [
      { label: "Search Console", to: "/p/$projectId/search-performance" },
      { label: "Rank tracking", to: "/p/$projectId/rank-tracking" },
    ],
  },
  {
    label: "Technical SEO",
    segments: ["audit", "technical"],
    tabs: [
      { label: "Site audit", to: "/p/$projectId/audit" },
      { label: "AI crawlers", to: "/p/$projectId/technical/ai-crawlers" },
      { label: "Indexing", to: "/p/$projectId/technical/indexing" },
    ],
  },
  {
    label: "AI Search",
    segments: ["ai-visibility", "prompt-explorer"],
    tabs: [
      { label: "Visibility", to: "/p/$projectId/ai-visibility/insights" },
      { label: "Perception", to: "/p/$projectId/ai-visibility/perception" },
      {
        label: "Sources",
        to: "/p/$projectId/ai-visibility/citations",
        views: [
          {
            label: "Citation gaps",
            to: "/p/$projectId/ai-visibility/citations",
          },
          {
            label: "Source intelligence",
            to: "/p/$projectId/ai-visibility/sources",
          },
        ],
      },
      {
        label: "Prompts",
        to: "/p/$projectId/ai-visibility",
        views: [
          {
            label: "Prompt tracking",
            to: "/p/$projectId/ai-visibility",
            exact: true,
          },
          {
            label: "Prompt research",
            to: "/p/$projectId/ai-visibility/research",
          },
          { label: "Prompt explorer", to: "/p/$projectId/prompt-explorer" },
        ],
      },
      { label: "Claims", to: "/p/$projectId/ai-visibility/claims" },
      { label: "Brand facts", to: "/p/$projectId/ai-visibility/facts" },
    ],
  },
  {
    label: "Act",
    segments: ["opportunities", "content", "changes"],
    tabs: [
      { label: "Opportunities", to: "/p/$projectId/opportunities" },
      { label: "Content Studio", to: "/p/$projectId/content" },
      { label: "Workflows & changes", to: "/p/$projectId/changes" },
    ],
  },
];

export function hubForPath(pathname: string, projectId: string): Hub | null {
  return (
    hubs.find((hub) =>
      hub.segments.some((segment) => {
        const prefix = `/p/${projectId}/${segment}`;
        return pathname === prefix || pathname.startsWith(`${prefix}/`);
      }),
    ) ?? null
  );
}

function pathMatches(
  pathname: string,
  projectId: string,
  page: Pick<HubTab, "to" | "exact">,
) {
  const prefix = page.to.replace("$projectId", projectId);
  return (
    pathname === prefix || (!page.exact && pathname.startsWith(`${prefix}/`))
  );
}

/** The tab a path belongs to: its own page or any page grouped under it. */
export function activeHubTab(
  tabs: readonly HubTab[],
  pathname: string,
  projectId: string,
) {
  return (
    tabs.find((tab) =>
      (tab.views ?? [tab]).some((page) =>
        pathMatches(pathname, projectId, page),
      ),
    ) ?? null
  );
}
