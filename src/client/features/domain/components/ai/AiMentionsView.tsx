import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { HelpLabel } from "@/client/components/HelpLabel";
import { QueryError } from "@/client/components/QueryState";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  PLATFORM_LABELS,
  Questions,
} from "@/client/features/domain/components/ai/AiQuestionsTable";
import { IntersectionCard } from "@/client/features/domain/components/ai/IntersectionCard";
import { SourceNote } from "@/client/features/domain/components/overview/SourceNote";
import { formatNumber } from "@/client/features/domain/utils";
import { useCostDisplay } from "@/client/features/spend/useCostDisplay";
import { getDomainAiMentions } from "@/serverFunctions/domainIntersection";
import type { ResearchScope } from "@/shared/researchScope";

type Mentions = Awaited<ReturnType<typeof getDomainAiMentions>>;
export type Stored = Extract<Mentions, { status: "stored" }>;

/**
 * What the provider's AI mentions database holds for this domain, plus where
 * those answers meet Google organic results. Nothing here starts a paid read:
 * a missing lookup is offered behind a click that states its cost.
 */
export function AiMentionsView({
  projectId,
  domain,
  scope,
  locationCode,
  projectDomain,
}: {
  projectId: string;
  domain: string;
  scope: ResearchScope;
  locationCode: number | undefined;
  projectDomain: string | undefined;
}) {
  const query = useQuery({
    queryKey: ["domain-ai-mentions", projectId, domain],
    queryFn: () => getDomainAiMentions({ data: { projectId, domain } }),
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });

  if (query.isLoading) {
    return (
      <Card className="gap-3 p-4" aria-busy>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-40 w-full" />
      </Card>
    );
  }
  if (query.isError) {
    return (
      <QueryError
        variant="card"
        error={query.error}
        fallback="AI mentions failed to load."
        onRetry={() => void query.refetch()}
        isRetrying={query.isFetching}
      />
    );
  }
  const data = query.data;
  if (!data) return null;

  return (
    <>
      {data.status === "not_run" ? (
        <NotRun projectId={projectId} data={data} />
      ) : (
        <Summary projectId={projectId} data={data} />
      )}
      {data.status === "stored" && data.hasData ? (
        <>
          <Questions data={data} />
          <Pages data={data} />
        </>
      ) : null}
      <IntersectionCard
        projectId={projectId}
        domain={domain}
        scope={scope}
        locationCode={locationCode}
      />
      <TrackedLink projectId={projectId} domain={domain} own={projectDomain} />
    </>
  );
}

function lookupLink(projectId: string, domain: string) {
  return (
    <Link
      to="/p/$projectId/brand-lookup"
      params={{ projectId }}
      search={{ q: domain }}
    />
  );
}

function NotRun({
  projectId,
  data,
}: {
  projectId: string;
  data: Extract<Mentions, { status: "not_run" }>;
}) {
  const { cost } = useCostDisplay();
  return (
    <Card className="gap-3 p-4">
      <h2 className="text-base font-semibold">AI mentions</h2>
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          No AI mentions lookup is stored for {data.domain} in this market. The
          lookup reads ChatGPT and Google AI Overviews and is saved for a day.
        </p>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={lookupLink(projectId, data.domain)}
        >
          {cost(data.estimateUsd)
            ? `Run the lookup, up to ${cost(data.estimateUsd)}`
            : "Run the lookup"}
        </Button>
      </div>
    </Card>
  );
}

function Summary({ projectId, data }: { projectId: string; data: Stored }) {
  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">
          <HelpLabel
            label="AI mentions"
            helpText="Answers the provider has collected and indexed that mention this domain. It is what the provider holds, not a sample of all AI answers, so a total here is not a visibility percentage."
          />
        </h2>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={lookupLink(projectId, data.domain)}
        >
          Open the full lookup
        </Button>
      </div>
      <SourceNote
        source="DataForSEO AI mentions database"
        date={data.fetchedAt}
      />
      {!data.hasData ? (
        <p className="text-sm text-muted-foreground">
          The provider holds no AI answers that mention {data.domain}.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Total mentions" value={data.totalMentions} />
          {data.perPlatform.map((row) => (
            <Stat
              key={row.platform}
              label={PLATFORM_LABELS[row.platform]}
              value={row.status === "success" ? row.mentions : null}
              note={
                row.status === "success" && row.aiSearchVolume != null
                  ? `${formatNumber(row.aiSearchVolume)} AI search volume`
                  : row.status === "error"
                    ? "Could not be read"
                    : undefined
              }
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: number | null;
  note?: string;
}) {
  return (
    <div className="min-w-0 space-y-0.5 rounded-lg border border-border p-3">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">
        {value == null ? "-" : formatNumber(value)}
      </div>
      {note ? (
        <div className="text-xs text-muted-foreground">{note}</div>
      ) : null}
    </div>
  );
}

function Pages({ data }: { data: Stored }) {
  if (data.topPages.length === 0) return null;
  return (
    <Card className="gap-3 p-4">
      <h2 className="text-base font-semibold">
        <HelpLabel
          label="Pages AI answers cite"
          helpText="Pages from this domain the provider saw cited, with the example questions behind them. Counts are citations in the provider's data, not page views."
        />
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="py-1 text-left font-normal">Page</th>
              <th className="py-1 pl-3 text-left font-normal">Engine</th>
              <th className="py-1 pl-3 text-right font-normal">Citations</th>
              <th className="py-1 pl-3 text-left font-normal">
                Example question
              </th>
            </tr>
          </thead>
          <tbody>
            {data.topPages.slice(0, 15).map((row) => (
              <tr
                key={`${row.platform}:${row.url}`}
                className="border-t border-border align-top"
              >
                <td className="py-1.5 pr-2 break-all">
                  <a
                    href={row.url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {row.url.replace(/^https?:\/\//, "")}
                  </a>
                </td>
                <td className="py-1.5 pl-3 whitespace-nowrap">
                  {PLATFORM_LABELS[row.platform]}
                </td>
                <td className="py-1.5 pl-3 text-right tabular-nums">
                  {formatNumber(row.mentions)}
                </td>
                <td className="py-1.5 pl-3 break-words">
                  {row.keywords[0]?.question ?? "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function TrackedLink({
  projectId,
  domain,
  own,
}: {
  projectId: string;
  domain: string;
  own: string | undefined;
}) {
  const isOwn = own !== undefined && own === domain;
  return (
    <Card className="flex-row flex-wrap items-center gap-3 p-4">
      <p className="min-w-0 flex-1 text-sm text-muted-foreground">
        {isOwn
          ? "Tracked AI Search measures your own prompts repeatedly, per engine, with mention, citation and recommendation recorded separately."
          : "Tracked AI Search measures your own project's prompts over time. This tab shows what the provider has observed for the domain you are exploring."}
      </p>
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={
          <Link to="/p/$projectId/ai-visibility" params={{ projectId }} />
        }
      >
        Open tracked AI Search
      </Button>
    </Card>
  );
}
