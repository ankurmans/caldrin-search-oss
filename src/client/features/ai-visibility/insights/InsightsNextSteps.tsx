import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { PRIORITY_STYLE } from "@/client/features/ai-perception/PerceptionOpportunities";
import {
  perceptionOpportunitiesQueryOptions,
  perceptionViewQueryOptions,
} from "@/client/features/ai-perception/perceptionShared";
import type { InsightsFilters } from "./insightsShared";

const SHOWN = 3;

/** The top findings from Perception, so the first tab ends in something to do. */
export function InsightsNextSteps({
  projectId,
  filters,
}: {
  projectId: string;
  filters: InsightsFilters;
}) {
  const opportunities = useQuery(
    perceptionOpportunitiesQueryOptions(projectId, filters),
  );
  const view = useQuery(perceptionViewQueryOptions(projectId, filters));
  const items = opportunities.data?.opportunities.slice(0, SHOWN) ?? [];
  const unread = view.data?.unread.answers ?? 0;
  if (!items.length && !unread) return null;
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">What to do next</h2>
        <Link
          to="/p/$projectId/ai-visibility/perception"
          params={{ projectId }}
          className="text-sm underline underline-offset-2"
        >
          Open Perception
        </Link>
      </div>
      {unread ? (
        <p className="text-sm text-muted-foreground">
          {unread} {unread === 1 ? "answer names" : "answers name"} a brand
          without being read yet, so the Recommended column may be low. Read{" "}
          {unread === 1 ? "it" : "them"} in Perception.
        </p>
      ) : null}
      {items.length ? (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-2 text-sm">
              <span
                className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs ${PRIORITY_STYLE[item.priority]}`}
              >
                {item.priority}
              </span>
              <span className="min-w-0 break-words">{item.title}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
