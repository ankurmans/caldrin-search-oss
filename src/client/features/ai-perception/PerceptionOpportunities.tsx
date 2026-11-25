import { useState } from "react";
import {
  useMutation,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { EngineLabel } from "@/client/features/ai-visibility/EngineLabel";
import { HighlightedAnswerById } from "@/client/features/ai-visibility/HighlightedAnswerLoader";
import {
  ofText,
  type InsightsFilters,
} from "@/client/features/ai-visibility/insights/insightsShared";
import {
  AiLoading,
  AiQueryError,
} from "@/client/features/ai-visibility/shared";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { saveAiPerceptionOpportunity } from "@/serverFunctions/ai-perception";
import {
  PERCEPTION_OPPORTUNITY_LABELS,
  type AiPerceptionOpportunities,
  type PerceptionOpportunity,
} from "@/shared/ai-perception-opportunities";

const ROUTE_LABEL = {
  content_studio: "Content Studio",
  link_acquisition: "Link acquisition",
  human_decision: "Needs a person's decision",
} as const;

export const PRIORITY_STYLE = {
  high: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200",
  medium:
    "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200",
  low: "bg-muted text-muted-foreground",
} as const;

function Opportunity({
  projectId,
  filters,
  item,
}: {
  projectId: string;
  filters: InsightsFilters;
  item: PerceptionOpportunity;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      saveAiPerceptionOpportunity({
        data: { projectId, ...filters, opportunityId: item.id },
      }),
    onSuccess: (result) => {
      if (!result.ok) return void toast.error(result.reason);
      toast.success("Saved to Opportunities");
      void queryClient.invalidateQueries({ queryKey: ["opportunities"] });
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not save")),
  });
  return (
    <li className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="secondary">
          {PERCEPTION_OPPORTUNITY_LABELS[item.kind]}
        </Badge>
        <span
          className={`rounded px-1.5 py-0.5 ${PRIORITY_STYLE[item.priority]}`}
        >
          {item.priority} priority
        </span>
        <span className="text-muted-foreground">
          {item.confidence} confidence · {item.effort} effort ·{" "}
          {ofText(item.answers)} answers
        </span>
      </div>
      <h3 className="font-medium">{item.title}</h3>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide evidence" : "Show evidence"}
        </Button>
        <Button
          size="sm"
          disabled={save.isPending || save.data?.ok === true}
          onClick={() => save.mutate()}
        >
          {save.data?.ok ? "Saved" : "Save to Opportunities"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Route: {ROUTE_LABEL[item.route]}
        </span>
        {save.data?.ok ? (
          <Link
            to="/p/$projectId/opportunities"
            params={{ projectId }}
            className="text-xs underline"
          >
            Open Opportunities
          </Link>
        ) : null}
      </div>
      {open ? (
        <div className="space-y-3 text-sm">
          <p>
            <span className="font-medium">Observed. </span>
            {item.observed}
          </p>
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">
              Inferred, not tested.{" "}
            </span>
            {item.inferred}
          </p>
          {item.buyerQuestions.length ? (
            <div>
              <p className="text-xs font-medium">Buyer questions</p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {item.buyerQuestions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <ul className="space-y-3">
            {item.evidence.map((e, i) => (
              <li key={`${e.observationId}-${i}`} className="space-y-1">
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <EngineLabel engine={e.engine} />
                  {e.note}
                </p>
                {e.quote ? (
                  <blockquote className="border-l-2 pl-3 italic text-muted-foreground">
                    “{e.quote}”
                  </blockquote>
                ) : null}
                {e.observationId ? (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setShown((cur) =>
                          cur === `${e.observationId}-${i}`
                            ? null
                            : `${e.observationId}-${i}`,
                        )
                      }
                    >
                      {shown === `${e.observationId}-${i}`
                        ? "Hide full answer"
                        : "Show full answer"}
                    </Button>
                    {shown === `${e.observationId}-${i}` ? (
                      <HighlightedAnswerById
                        projectId={projectId}
                        observationId={e.observationId}
                      />
                    ) : null}
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

export function PerceptionOpportunities({
  projectId,
  filters,
  query,
}: {
  projectId: string;
  filters: InsightsFilters;
  query: UseQueryResult<AiPerceptionOpportunities>;
}) {
  if (query.isPending) return <AiLoading />;
  if (query.isError)
    return (
      <AiQueryError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  const { opportunities, notes } = query.data;
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-base font-medium">Perception opportunities</h2>
        {notes.map((n) => (
          <p key={n} className="text-sm text-muted-foreground">
            {n}
          </p>
        ))}
      </div>
      {opportunities.length ? (
        <ul className="space-y-3">
          {opportunities.map((o) => (
            <Opportunity
              key={o.id}
              projectId={projectId}
              filters={filters}
              item={o}
            />
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          No findings in these answers.
        </p>
      )}
    </section>
  );
}
