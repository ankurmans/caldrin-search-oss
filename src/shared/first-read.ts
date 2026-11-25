export type FirstReadKind =
  | "search_query"
  | "missing_titles"
  | "titles_found"
  | "ai_citations"
  | "organic_keywords"
  | "competitor_keywords";

export type FirstReadSearchConsole =
  | "skipped"
  | "read"
  | "unavailable"
  | "no_history";

export type FirstReadFinding = {
  rank: number;
  kind: FirstReadKind;
  subject: string;
  metric: number;
  relatedMetric: number | null;
  page: string | null;
  observedAt: string;
  rangeStart: string | null;
  rangeEnd: string | null;
};

export type ProjectFirstRead =
  | { status: "no_site" | "pending" }
  | {
      status: "ready";
      completedAt: string;
      searchConsole: FirstReadSearchConsole;
      findings: FirstReadFinding[];
    };
