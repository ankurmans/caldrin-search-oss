import { captureClientEvent } from "@/client/lib/posthog";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Input } from "@/client/components/ui/input";
import { Button } from "@/client/components/ui/button";
import { QueryError } from "@/client/components/QueryState";
import { HighlightedAnswerById } from "@/client/features/ai-visibility/HighlightedAnswerLoader";
import { aiMarketLabel } from "@/shared/ai-visibility";
import { engineLabel } from "@/types/schemas/source-intelligence";
import {
  getFanOutAnswer,
  saveFanOutOpportunityAction,
} from "@/serverFunctions/source-intelligence";

export function captureLabel(
  count: number,
  exposed: boolean | null,
  kind: string,
) {
  if (count) return `Reported ${kind}`;
  if (exposed === null) return "Capture status unknown";
  return exposed
    ? `Empty ${kind} list`
    : `${kind[0]?.toUpperCase()}${kind.slice(1)} unavailable from provider`;
}

export function FanOutAnswer({
  projectId,
  observationId,
}: {
  projectId: string;
  observationId: string;
}) {
  const answer = useQuery({
    queryKey: ["fan-out-answer", projectId, observationId],
    queryFn: () => getFanOutAnswer({ data: { projectId, observationId } }),
  });
  if (answer.isPending)
    return (
      <p role="status" className="py-3 text-sm">
        Loading evidence…
      </p>
    );
  if (answer.isError)
    return (
      <QueryError
        error={answer.error}
        fallback="Could not load answer evidence."
        onRetry={() => void answer.refetch()}
      />
    );
  if (!answer.data)
    return (
      <p className="py-3 text-sm text-muted-foreground">
        This answer is unavailable in this project.
      </p>
    );
  const { data } = answer;
  const cited = new Set(data.cited.map((page) => page.url));
  return (
    <div className="mt-3 space-y-4 border-t pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{data.prompt}</p>
        <Link
          to="/p/$projectId/ai-visibility/sources"
          params={{ projectId }}
          search={{
            view: "queries",
            promptId: data.promptId,
            answer: observationId,
            locationCode: data.locationCode,
            languageCode: data.languageCode,
          }}
          className="text-xs underline"
        >
          Link to evidence
        </Link>
      </div>
      <p className="text-xs text-muted-foreground">
        {engineLabel(data.engine)} · {aiMarketLabel(data)} ·{" "}
        {data.collectedAt?.slice(0, 10) ?? "Date unavailable"} ·{" "}
        {data.promptVersion
          ? `Prompt set v${data.promptVersion}`
          : "Prompt version unavailable"}
      </p>
      <div className="grid gap-4 text-sm lg:grid-cols-3">
        <section>
          <h3 className="font-medium">Reported searches</h3>
          {data.queries.length ? (
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              {data.queries.map((term) => (
                <li key={term} className="break-words">
                  {term}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-xs text-muted-foreground">
              {captureLabel(0, data.queriesExposed, "searches")}
            </p>
          )}
        </section>
        <EvidencePages
          heading="Retrieved pages"
          pages={data.retrieved}
          empty={captureLabel(0, data.retrievalExposed, "retrieved pages")}
          annotation={(url) => (cited.has(url) ? "Also cited" : null)}
        />
        <EvidencePages
          heading="Cited pages"
          pages={data.cited}
          empty="No citations recorded."
          annotation={(_url, origin) =>
            origin === "answer_link" ? "Link in answer" : null
          }
        />
      </div>
      {data.retrieved.length > 0 && data.queries.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          The provider reports these pages for the answer as a whole.
        </p>
      ) : null}
      <SaveFinding projectId={projectId} observationId={observationId} />
      <details className="text-sm">
        <summary className="cursor-pointer font-medium">
          Read saved answer
        </summary>
        <HighlightedAnswerById
          projectId={projectId}
          observationId={observationId}
        />
      </details>
    </div>
  );
}

function EvidencePages({
  heading,
  pages,
  empty,
  annotation,
}: {
  heading: string;
  empty: string;
  pages: { url: string; title: string | null; origin?: string | null }[];
  annotation: (url: string, origin?: string | null) => string | null;
}) {
  return (
    <section className="min-w-0">
      <h3 className="font-medium">{heading}</h3>
      {pages.length ? (
        <ul className="mt-1 space-y-1">
          {pages.map((page, index) => (
            <li key={`${page.url}:${index}`} className="break-all">
              {/^https?:\/\//i.test(page.url) ? (
                <a
                  href={page.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  {page.title ?? page.url}
                </a>
              ) : (
                (page.title ?? page.url)
              )}
              {annotation(page.url, page.origin) ? (
                <span className="ml-2 text-xs text-muted-foreground">
                  {annotation(page.url, page.origin)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

function SaveFinding({
  projectId,
  observationId,
}: {
  projectId: string;
  observationId: string;
}) {
  const [pageUrl, setPageUrl] = useState("");
  const action = useMutation({
    mutationFn: () =>
      saveFanOutOpportunityAction({
        data: {
          projectId,
          observationId,
          pageUrl: pageUrl.trim() || undefined,
        },
      }),
    onSuccess: (result) => {
      if (!result.ok) toast.error(result.reason);
      else
        captureClientEvent("query_fan_out:finding_saved", {
          projectId,
          observationId,
          opportunityId: result.data.opportunityId,
        });
    },
    onError: () => toast.error("Could not save this finding."),
  });
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-medium">Use in brief</summary>
      <form
        className="mt-2 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          action.mutate();
        }}
      >
        <label className="min-w-0 grow text-xs">
          Target page on your site (optional)
          <Input
            type="url"
            value={pageUrl}
            maxLength={2048}
            onChange={(event) => setPageUrl(event.target.value)}
            placeholder="https://…"
            className="mt-1"
          />
        </label>
        <Button size="sm" type="submit" pending={action.isPending}>
          Save finding
        </Button>
        {action.data?.ok ? (
          <Link
            className="text-sm underline"
            to="/p/$projectId/content"
            params={{ projectId }}
            search={{ opportunity: action.data.data.opportunityId }}
          >
            Open in Content Studio
          </Link>
        ) : null}
      </form>
    </details>
  );
}
