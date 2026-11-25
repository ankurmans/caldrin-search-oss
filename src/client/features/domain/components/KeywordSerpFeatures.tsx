const FEATURE_LABELS: Record<string, string> = {
  ai_overview: "AI Overview",
  featured_snippet: "Featured snippet",
  people_also_ask: "People also ask",
  local_pack: "Local pack",
  images: "Images",
  video: "Video",
  top_stories: "Top stories",
  knowledge_graph: "Knowledge panel",
  related_searches: "Related searches",
  shopping: "Shopping",
  google_flights: "Flights",
  answer_box: "Answer box",
  find_results_on: "Find results on",
  discussions_and_forums: "Forums",
  short_videos: "Short videos",
  popular_products: "Popular products",
};

export function serpFeatureLabel(type: string) {
  return FEATURE_LABELS[type] ?? type.replaceAll("_", " ");
}

/** The first features inline, the rest counted; full list is in the inspector. */
export function KeywordSerpFeatures({
  features,
  limit = 2,
}: {
  features: string[];
  limit?: number;
}) {
  if (features.length === 0) {
    return <span className="text-muted-foreground">-</span>;
  }
  const shown = features.slice(0, limit);
  const rest = features.length - shown.length;
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((feature) => (
        <span
          key={feature}
          className="rounded bg-muted px-1.5 py-0.5 text-xs whitespace-nowrap"
        >
          {serpFeatureLabel(feature)}
        </span>
      ))}
      {rest > 0 ? (
        <span className="px-1 text-xs text-muted-foreground">+{rest}</span>
      ) : null}
    </span>
  );
}
