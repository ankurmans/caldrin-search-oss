import { HelpLabel } from "@/client/components/HelpLabel";
import { Card } from "@/client/components/ui/card";
import { formatNumber } from "@/client/features/backlinks/backlinksPageUtils";
import {
  DATAFORSEO_ESTIMATE,
  SourceNote,
} from "@/client/features/domain/components/overview/SourceNote";
import type { getDomainOverview } from "@/serverFunctions/domain";

type Overview = Awaited<ReturnType<typeof getDomainOverview>>;

function formatUsd(value: number | null) {
  if (value == null) return "-";
  return `$${new Intl.NumberFormat().format(Math.round(value))}`;
}

function Metric({
  label,
  help,
  value,
}: {
  label: string;
  help: string;
  value: string;
}) {
  return (
    <div className="min-w-0 space-y-1 rounded-lg border border-border p-3">
      <div className="text-sm text-muted-foreground">
        <HelpLabel label={label} helpText={help} />
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/** Core organic metrics for the searched domain, all from one provider read. */
export function OverviewMetricsCard({
  overview,
  variant,
  domainRank,
  domainRankDate,
}: {
  overview: Overview;
  /** Overview adds the backlink-based Domain Rank; Organic keeps search metrics. */
  variant: "overview" | "organic";
  /** From the backlinks read, which can load later or fail on its own. */
  domainRank: number | null | undefined;
  domainRankDate: string | undefined;
}) {
  const top3 = overview.positions
    ? overview.positions.top1 + overview.positions.top2to3
    : null;
  const dash = (value: number | null) =>
    overview.hasData ? formatNumber(value) : "-";

  return (
    <Card className="gap-3 p-4">
      <div
        className={`grid grid-cols-2 gap-3 md:grid-cols-3 ${variant === "overview" ? "xl:grid-cols-5" : "xl:grid-cols-4"}`}
      >
        <Metric
          label="Organic keywords"
          help="Keywords the provider sees this domain ranking for in Google's organic results, in this market. The keyword list below is counted the same way."
          value={dash(overview.organicKeywords)}
        />
        <Metric
          label="Keywords in top 3"
          help="Organic keywords ranking in positions 1 to 3."
          value={dash(top3)}
        />
        <Metric
          label="Est. organic traffic"
          help="Estimated monthly visits from organic search, modelled from rankings and search volume. Not measured visits; connect Search Console for actual clicks on your own sites."
          value={dash(overview.organicTraffic)}
        />
        <Metric
          label="Est. traffic value"
          help="What the provider estimates the same organic traffic would cost as paid clicks, per month."
          value={overview.hasData ? formatUsd(overview.trafficValueUsd) : "-"}
        />
        {variant === "overview" ? (
          <Metric
            label="Domain Rank"
            help="DataForSEO Domain Rank, 0 to 1000, from the backlink profile. A different scale from other vendors' domain scores; compare it only with other Domain Rank values."
            value={domainRank == null ? "-" : formatNumber(domainRank)}
          />
        ) : null}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <SourceNote source={DATAFORSEO_ESTIMATE} date={overview.fetchedAt} />
        {variant === "overview" ? (
          <SourceNote
            source="Domain Rank: DataForSEO backlink index"
            date={domainRankDate}
          />
        ) : null}
      </div>
    </Card>
  );
}
