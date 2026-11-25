import { sortBy } from "remeda";
import { QueryError } from "@/client/components/QueryState";
import { HelpLabel } from "@/client/components/HelpLabel";
import { Card } from "@/client/components/ui/card";
import { Skeleton } from "@/client/components/ui/skeleton";
import { intentLabel } from "@/client/features/domain/components/KeywordIntentBadge";
import { serpFeatureLabel } from "@/client/features/domain/components/KeywordSerpFeatures";
import {
  DATAFORSEO_ESTIMATE,
  SourceNote,
} from "@/client/features/domain/components/overview/SourceNote";
import type { useDomainKeywordSummaryQuery } from "@/client/features/domain/hooks/useDomainSampleQueries";
import { formatNumber, formatRounded } from "@/client/features/domain/utils";

type SummaryQuery = ReturnType<typeof useDomainKeywordSummaryQuery>;
type Summary = NonNullable<SummaryQuery["data"]>;

function Bar({ share }: { share: number }) {
  return (
    <div className="h-2 w-full rounded-full bg-muted">
      <div
        className="h-2 rounded-full bg-amber-400"
        style={{ width: `${Math.max(share * 100, share > 0 ? 2 : 0)}%` }}
      />
    </div>
  );
}

function IntentRows({ summary }: { summary: Summary }) {
  const rows = sortBy(
    Object.entries(summary.intents).map(([intent, bucket]) => ({
      intent,
      ...bucket,
    })),
    [(row) => row.traffic, "desc"],
  );
  const totalTraffic = rows.reduce((sum, row) => sum + row.traffic, 0);
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-muted-foreground">
        <tr>
          <th className="py-1 text-left font-normal">Intent</th>
          <th className="py-1 text-right font-normal">Keywords</th>
          <th className="py-1 text-right font-normal">Est. traffic</th>
          <th className="w-24 py-1 pl-3 font-normal" />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.intent} className="border-t border-border">
            <td className="py-1.5">
              {row.intent === "unclassified"
                ? "Not classified"
                : intentLabel(row.intent)}
            </td>
            <td className="py-1.5 text-right tabular-nums">
              {formatNumber(row.keywords)}
            </td>
            <td className="py-1.5 text-right tabular-nums">
              {formatRounded(row.traffic)}
            </td>
            <td className="py-1.5 pl-3">
              <Bar share={totalTraffic > 0 ? row.traffic / totalTraffic : 0} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Intent, name-match and SERP features over the domain's top keywords by traffic. */
export function KeywordSampleCard({ query }: { query: SummaryQuery }) {
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
        fallback="Keyword breakdown failed to load."
        onRetry={() => void query.refetch()}
        isRetrying={query.isFetching}
      />
    );
  }
  const summary = query.data;
  if (!summary || summary.sampleSize === 0) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        The provider returned no ranked keywords to break down.
      </Card>
    );
  }
  const { nameMatch } = summary;
  const nameTotal = nameMatch
    ? nameMatch.matching.traffic + nameMatch.other.traffic
    : 0;

  return (
    <Card className="gap-4 p-4">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">
          <HelpLabel
            label="Keyword breakdown"
            helpText="Intent is the provider's main intent for each keyword. A name match means the keyword contains the domain's name; it is not a verified brand split."
          />
        </h2>
        <p className="text-xs text-muted-foreground">
          Top {formatNumber(summary.sampleSize)} keywords by estimated traffic
          {summary.totalListed != null
            ? ` of ${formatNumber(summary.totalListed)} the provider lists`
            : ""}
          . Not a total for the whole domain.
        </p>
      </div>
      <IntentRows summary={summary} />
      {nameMatch ? (
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span>
              Contains “{nameMatch.term}”:{" "}
              {formatNumber(nameMatch.matching.keywords)} keywords
            </span>
            <span className="tabular-nums text-muted-foreground">
              {nameTotal > 0
                ? Math.round((nameMatch.matching.traffic / nameTotal) * 100)
                : 0}
              % of sample traffic
            </span>
          </div>
          <Bar
            share={nameTotal > 0 ? nameMatch.matching.traffic / nameTotal : 0}
          />
        </div>
      ) : null}
      {summary.serpFeatures.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">
            Features on these keywords' results
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {summary.serpFeatures.map((row) => (
              <li
                key={row.feature}
                className="rounded bg-muted px-2 py-0.5 text-xs"
              >
                {serpFeatureLabel(row.feature)}{" "}
                <span className="tabular-nums text-muted-foreground">
                  {formatNumber(row.keywords)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <SourceNote source={DATAFORSEO_ESTIMATE} date={summary.fetchedAt} />
    </Card>
  );
}
