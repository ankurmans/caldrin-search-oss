import { useQuery } from "@tanstack/react-query";
import { QueryError } from "@/client/components/QueryState";
import { SkeletonCard } from "@/client/components/SkeletonPresets";
import { SectionHeader } from "@/client/components/PageHeader";
import { getContentPerformanceReport } from "@/serverFunctions/contentEditorial";

export function ContentPerformance({ projectId }: { projectId: string }) {
  const query = useQuery({
    queryKey: ["content-performance", projectId],
    queryFn: () => getContentPerformanceReport({ data: { projectId } }),
  });
  if (query.isLoading) return <SkeletonCard />;
  if (query.isError) {
    return (
      <QueryError error={query.error} fallback="Could not load performance." />
    );
  }
  const articles = query.data?.articles ?? [];
  if (articles.length === 0) return null;
  return (
    <section className="space-y-3">
      <SectionHeader
        title="Performance"
        hint="Search Console results for published articles, last 28 days ending three days ago. These are observations, not proof that an article caused them."
      />
      <ul className="divide-y rounded-xl border bg-card">
        {articles.map((a) => (
          <li key={a.assetId} className="space-y-1 p-3">
            <p className="text-sm font-medium">{a.title}</p>
            <p className="text-xs text-muted-foreground">
              Revision {a.revision}
              {a.publishedAt
                ? ` · published ${a.publishedAt.slice(0, 10)}`
                : ""}
              {a.query ? ` · target: ${a.query}` : ""}
            </p>
            {a.current ? (
              <p className="text-xs">
                {a.current.clicks} clicks · {a.current.impressions} impressions
                · {(a.current.ctr * 100).toFixed(1)}% CTR · position{" "}
                {a.current.position.toFixed(1)}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {a.note ??
                  (a.status === "too_early"
                    ? "Too new: Search Console needs about a week."
                    : "No Search Console data for this page yet.")}
              </p>
            )}
            {a.suggestions.map((s) => (
              <p key={s.action} className="text-xs text-muted-foreground">
                Suggestion: {s.action.replaceAll("_", " ")} — {s.reason}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
