// Vocabulary shared by the link acquisition schema, server and UI.

export const LINK_CAMPAIGN_MODES = [
  "earned_editorial",
  "partnership",
  "sponsored_distribution",
] as const;
export type LinkCampaignMode = (typeof LINK_CAMPAIGN_MODES)[number];

export const LINK_CAMPAIGN_MODE_LABELS: Record<LinkCampaignMode, string> = {
  earned_editorial: "Earned editorial",
  partnership: "Partnership or association",
  sponsored_distribution: "Sponsored distribution",
};

export const LINK_PROSPECT_STATUSES = [
  "discovered",
  "qualified",
  "ready",
  "outreach_approved",
  "contacted",
  "responded",
  "acquired",
  "rejected",
  "lost",
] as const;
export type LinkProspectStatus = (typeof LINK_PROSPECT_STATUSES)[number];

export const LINK_PROSPECT_STATUS_LABELS: Record<LinkProspectStatus, string> = {
  discovered: "Discovered",
  qualified: "Qualified",
  ready: "Ready",
  outreach_approved: "Outreach approved",
  contacted: "Contacted",
  responded: "Responded",
  acquired: "Acquired",
  rejected: "Rejected",
  lost: "Lost or removed",
};

export const LINK_DISCOVERY_METHODS = [
  "competitor_intersection",
  "lost_link",
  "broken_link",
  "brand_mention",
  "ai_citation",
  "manual",
] as const;
export type LinkDiscoveryMethod = (typeof LINK_DISCOVERY_METHODS)[number];

export const LINK_DISCOVERY_METHOD_LABELS: Record<LinkDiscoveryMethod, string> =
  {
    competitor_intersection: "Competitor link gap",
    lost_link: "Lost link",
    broken_link: "Broken link",
    brand_mention: "Unlinked brand mention",
    ai_citation: "AI-cited source",
    manual: "Added by hand",
  };

export const LINK_RECOMMENDATIONS = ["pursue", "review", "skip"] as const;
export type LinkRecommendation = (typeof LINK_RECOMMENDATIONS)[number];

/** Competitors a link gap compares at once; the provider caps targets. */
export const LINK_GAP_MAX_COMPETITORS = 5;

export const LINK_RECOMMENDATION_LABELS: Record<LinkRecommendation, string> = {
  pursue: "Pursue",
  review: "Review",
  skip: "Skip",
};

export const LINK_SIGNAL_KINDS = [
  "ai_cited_answers",
  "ai_retrieved_answers",
  "ai_engines",
  "lost_link",
  "link_page_status",
  "brand_mention",
] as const;
export type LinkSignalKind = (typeof LINK_SIGNAL_KINDS)[number];

export const LINK_SIGNAL_LABELS: Record<LinkSignalKind, string> = {
  ai_cited_answers: "AI answers citing this source",
  ai_retrieved_answers: "AI answers retrieving this source",
  ai_engines: "AI engines",
  lost_link: "Lost link",
  link_page_status: "Linking page check",
  brand_mention: "Brand mention",
};

/** Who made a change: a person, an in-app assistant, an MCP agent, or the daily check. */
export const LINK_ACTORS = ["user", "sam", "mcp", "system"] as const;
export type LinkActor = (typeof LINK_ACTORS)[number];
