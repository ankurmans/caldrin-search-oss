import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { useCostDisplay } from "@/client/features/spend/useCostDisplay";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  createIntersectionOpportunity,
  estimateLiveSerp,
  type getDomainIntersection,
} from "@/serverFunctions/domainIntersection";
import { getSerpAnalysis } from "@/serverFunctions/keywords";
import type { ResearchScope } from "@/shared/researchScope";

const ENGINE_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  google_ai_overview: "Google AI Overviews",
  google_ai_mode: "Google AI Mode",
  claude: "Claude",
  perplexity: "Perplexity",
};

const SOURCE_LABELS = {
  provider_keywords: "Provider keyword sample",
  serp_read: "Stored SERP read",
  rank_tracker: "Rank tracker",
  provider_mentions: "Provider AI mentions",
  tracked_answers: "Tracked AI answers",
} as const;

type Intersection = Awaited<ReturnType<typeof getDomainIntersection>>;
export type Row = Intersection["rows"][number];

export function organicLabel(row: Row) {
  if (row.organicState === "ranked") return `Ranks #${row.organic?.position}`;
  if (row.organicState === "outside_depth") {
    return `Not in top ${row.organic?.depth}`;
  }
  return "Unchecked";
}

function day(iso: string | null | undefined) {
  return iso ? iso.slice(0, 10) : "date unknown";
}

export function Evidence({
  projectId,
  row,
  input,
  onChanged,
}: {
  projectId: string;
  row: Row;
  input: {
    projectId: string;
    domain: string;
    scope: ResearchScope;
    locationCode: number | undefined;
  };
  queryKey: unknown[];
  onChanged: () => void;
}) {
  const competing = row.answers.flatMap((a) => a.competingUrls).slice(0, 5);
  return (
    <div className="space-y-3 rounded-lg border border-border p-3 text-sm">
      <div>
        <div className="text-xs text-muted-foreground">Google organic</div>
        {row.organic ? (
          <p className="break-all">
            {organicLabel(row)}
            {row.organic.url ? ` · ${row.organic.url}` : ""} ·{" "}
            {SOURCE_LABELS[row.organic.source]}, {day(row.organic.checkedAt)}
            {row.organic.source === "provider_keywords"
              ? ". The sample is the domain's highest-traffic keywords, so a query outside it is simply not covered."
              : ""}
          </p>
        ) : (
          <p className="text-muted-foreground">
            No organic reading is stored for this query. That does not mean the
            domain does not rank.
          </p>
        )}
      </div>

      <div>
        <div className="text-xs text-muted-foreground">AI answers</div>
        <ul className="space-y-1">
          {row.answers.map((answer, index) => (
            <li key={`${answer.engine}:${answer.source}:${index}`}>
              <span className="font-medium">
                {ENGINE_LABELS[answer.engine] ?? answer.engine}
              </span>{" "}
              ·{" "}
              {answer.cited
                ? "cites the domain"
                : answer.named
                  ? "names the domain, no citation"
                  : "does not name the domain"}
              {answer.recommended === null
                ? ", recommendation not reported"
                : answer.recommended
                  ? ", recommends it"
                  : ", does not recommend it"}{" "}
              · {SOURCE_LABELS[answer.source]}, {day(answer.observedAt)}
              {answer.comparison && !answer.comparison.comparable
                ? ` · not compared: ${answer.comparison.reason}`
                : ""}
              {answer.citedUrls.length > 0 ? (
                <span className="block break-all text-muted-foreground">
                  {answer.citedUrls.join(", ")}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      {competing.length > 0 ? (
        <div>
          <div className="text-xs text-muted-foreground">
            Pages the answers cite instead
          </div>
          <ul className="space-y-0.5 break-all">
            {competing.map((url) => (
              <li key={url}>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  {url.replace(/^https?:\/\//, "")}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <RowActions
        projectId={projectId}
        row={row}
        input={input}
        onChanged={onChanged}
      />
    </div>
  );
}

function RowActions({
  projectId,
  row,
  input,
  onChanged,
}: {
  projectId: string;
  row: Row;
  input: {
    projectId: string;
    domain: string;
    scope: ResearchScope;
    locationCode: number | undefined;
  };
  onChanged: () => void;
}) {
  const { cost } = useCostDisplay();
  const [confirming, setConfirming] = useState(false);
  const [opportunityId, setOpportunityId] = useState<string | null>(null);

  const estimate = useQuery({
    queryKey: ["live-serp-estimate", projectId, row.key],
    queryFn: () => estimateLiveSerp({ data: { projectId, query: row.query } }),
    enabled: confirming,
    staleTime: 5 * 60_000,
  });
  const liveSerp = useMutation({
    mutationFn: () =>
      getSerpAnalysis({
        data: {
          projectId,
          keyword: row.query,
          locationCode: input.locationCode,
          depth: 10,
        },
      }),
    onSuccess: () => {
      setConfirming(false);
      toast.success("SERP read and saved");
      onChanged();
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "The SERP read failed")),
  });
  const create = useMutation({
    mutationFn: () =>
      createIntersectionOpportunity({ data: { ...input, query: row.key } }),
    onSuccess: (result) => {
      setOpportunityId(result.opportunityId);
      toast.success("Saved to Opportunities");
      onChanged();
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "That did not work")),
  });

  const plan = row.opportunity;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {opportunityId ? (
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={
              <Link
                to="/p/$projectId/opportunities"
                params={{ projectId }}
                search={{ opportunity: opportunityId }}
              />
            }
          >
            Open the opportunity
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={!plan?.ok || create.isPending}
            title={plan && !plan.ok ? plan.reason : undefined}
            onClick={() => create.mutate()}
          >
            Create Search Opportunity
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={
            <Link
              to="/p/$projectId/ai-visibility/citations"
              params={{ projectId }}
            />
          }
        >
          Citation gaps
        </Button>
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={
            <Link
              to="/p/$projectId/ai-visibility/sources"
              params={{ projectId }}
            />
          }
        >
          Compare competing pages
        </Button>
        {row.organic === null && !confirming ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirming(true)}
          >
            Check live SERP
          </Button>
        ) : null}
      </div>

      {plan ? (
        <p className="text-xs text-muted-foreground">
          {plan.ok
            ? `${plan.reason} Suggested: ${plan.action.replaceAll("_", " ")}.`
            : plan.reason}
        </p>
      ) : null}

      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 p-2">
          <span className="text-xs">
            Reads Google's top 10 for this query now
            {estimate.data && cost(estimate.data.estimateUsd)
              ? `, about ${cost(estimate.data.estimateUsd)}`
              : ""}
            . The result is saved and counts against your spend limit.
          </span>
          <Button
            size="sm"
            disabled={liveSerp.isPending || estimate.isLoading}
            onClick={() => liveSerp.mutate()}
          >
            Read it
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
}
