import { MetricsTable } from "@/client/components/MetricsTable";
import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Badge } from "@/client/components/ui/badge";
import { RESEARCH_SCOPE_LABELS } from "@/shared/researchScope";
import { HelpLabel } from "@/client/components/HelpLabel";
import { DEFAULT_BACKLINKS_SPAM_THRESHOLD } from "@/types/schemas/backlinks";
import {
  BacklinksNewLostChart,
  BacklinksTrendChart,
} from "./BacklinksPageCharts";
import type { BacklinksOverviewData } from "./backlinksPageTypes";
import { formatRelativeTimestamp } from "./backlinksPageUtils";

type SummaryStat = { label: string; value: string; description: string };

const SCOPE_NOTES: Partial<Record<BacklinksOverviewData["scope"], string>> = {
  exact_url:
    "Showing backlinks for this exact page. Switch the scope to Domain or Subdomains for site-wide results — trend charts need one of those.",
  subfolder:
    "Showing backlinks pointing into this subfolder. Counts come from filtered backlink totals; rank, trends, and the referring-domains breakdown need Domain or Subdomains scope.",
};

export function BacklinksScopeAlert({
  scope,
}: {
  scope: BacklinksOverviewData["scope"];
}) {
  const note = SCOPE_NOTES[scope];
  if (!note) return null;
  return (
    <Alert variant="info">
      <Info />
      <AlertDescription className="text-foreground">{note}</AlertDescription>
    </Alert>
  );
}

/** The header and overview sections at the top of the results card. */
export function BacklinksOverviewPanels({
  data,
  summaryStats,
}: {
  data: BacklinksOverviewData;
  summaryStats: SummaryStat[];
}) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold break-all">
            {data.displayTarget}
          </h2>
          <Badge variant="outline">{RESEARCH_SCOPE_LABELS[data.scope]}</Badge>
        </div>
        <p className="ml-auto text-xs text-muted-foreground">
          Updated {formatRelativeTimestamp(data.fetchedAt)}
        </p>
      </div>
      <div className="px-4 pb-4">
        <OverviewGrid data={data} summaryStats={summaryStats} />
      </div>
    </>
  );
}

function OverviewGrid({
  data,
  summaryStats,
}: {
  data: BacklinksOverviewData;
  summaryStats: SummaryStat[];
}) {
  // Trend charts need history/live, which only takes a whole hostname.
  const domainScope = data.scope === "domain" || data.scope === "subdomains";

  return (
    <div
      className={`grid grid-cols-1 gap-3 ${domainScope ? "md:grid-cols-2 xl:grid-cols-3" : ""}`}
    >
      <div
        className={`w-full max-w-xl rounded-lg border border-border p-3 ${domainScope ? "md:col-span-2 xl:col-span-1" : ""}`}
      >
        <MetricsTable
          rows={summaryStats.map((item) => ({
            label: <HelpLabel label={item.label} helpText={item.description} />,
            value: item.value,
          }))}
        />
      </div>
      {domainScope ? (
        <>
          <TrendPanel
            title="Backlink growth"
            description={
              data.scope === "domain"
                ? "Last year · Includes subdomains"
                : "Backlinks and referring domains over the last year"
            }
          >
            <BacklinksTrendChart
              data={data.trends}
              registeredAt={data.registeredAt}
            />
            <TrendCaveat
              registeredAt={data.registeredAt}
              spamScore={data.summary.backlinksSpamScore}
            />
          </TrendPanel>
          <TrendPanel
            title="New vs lost"
            description="Backlink acquisition and attrition"
          >
            <BacklinksNewLostChart data={data.newLostTrends} />
          </TrendPanel>
        </>
      ) : null}
    </div>
  );
}

// History comes from the domain name, not from this owner: a re-registered
// name keeps links to its earlier life, and spam lists that merely name a domain
// count as links. Say so next to the chart instead of letting it read as growth.
function TrendCaveat({
  registeredAt,
  spamScore,
}: {
  registeredAt: string | null;
  spamScore: number | null;
}) {
  const spammy =
    spamScore !== null && spamScore >= DEFAULT_BACKLINKS_SPAM_THRESHOLD;
  if (!spammy && !registeredAt) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {registeredAt
        ? `Domain registered ${registeredAt}; earlier history is inherited. `
        : ""}
      {spammy
        ? `Average spam score is ${Math.round(spamScore)}/100, so much of this growth is spam lists. The Backlinks table hides spam by default.`
        : ""}
    </p>
  );
}

function TrendPanel({
  children,
  description,
  title,
}: {
  children: React.ReactNode;
  description: string;
  title: string;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}
