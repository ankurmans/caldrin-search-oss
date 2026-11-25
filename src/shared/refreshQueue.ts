const REFRESH_ACTIONS = new Set([
  "refresh_existing_page",
  "improve_title_and_meta",
]);

export function canQueueRefresh(opportunity: {
  pageUrl: string | null;
  recommendedAction: string;
  status: string;
  query: string;
}) {
  return (
    Boolean(opportunity.pageUrl) &&
    REFRESH_ACTIONS.has(opportunity.recommendedAction) &&
    opportunity.status === "open" &&
    opportunity.query.trim().length >= 3
  );
}

export const REFRESH_QUEUE_LIMIT = 3;
