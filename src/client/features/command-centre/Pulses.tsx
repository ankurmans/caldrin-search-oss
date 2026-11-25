import { Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Button } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/skeleton";
import { percentChange } from "@/client/components/MetricsTable";
import { formatRelativeTime } from "@/client/lib/relative-time";
import { formatCompactNumber } from "@/client/features/keywords/utils";
import {
  formatCount,
  formatPosition,
} from "@/client/features/search-performance/SearchPerformanceColumns";
import { getSearchPerformanceReport } from "@/serverFunctions/searchPerformance";
import {
  Pulse,
  PulseNumber,
  PulseUnavailable,
} from "@/client/features/command-centre/Pulse";
import {
  signed,
  type CommandCentreData,
} from "@/client/features/command-centre/helpers";

// A three-column pulse is narrow: from ten thousand up the number is shortened
// (108,880 becomes 108.9K) so it cannot run into its neighbor.
function pulseCount(value: number) {
  return value < 10_000 ? formatCount(value) : formatCompactNumber(value);
}

function toneOf(change: number | null) {
  if (!change) return "neutral" as const;
  return change > 0 ? ("good" as const) : ("bad" as const);
}

export function OrganicPulse({
  projectId,
  gscConnected,
  siteUrl,
  rank,
}: {
  projectId: string;
  gscConnected: boolean;
  siteUrl: string | null;
  rank: CommandCentreData["rank"];
}) {
  // Same key as the Search Console card, so the report is read once.
  const report = useQuery({
    queryKey: ["dashboardGscReport", projectId, siteUrl, "last_28_days"],
    queryFn: () =>
      getSearchPerformanceReport({
        data: { projectId, dateRange: "last_28_days" },
      }),
    enabled: gscConnected,
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });
  const data = report.data;
  const connected = gscConnected && !(data && !data.connected);

  let body;
  if (!connected) {
    body = (
      <PulseUnavailable
        message="Search Console is not connected."
        action={
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={
              <Link
                to="/p/$projectId/settings/integrations"
                params={{ projectId }}
                hash="search-console"
              />
            }
          >
            Connect Search Console
          </Button>
        }
      />
    );
  } else if (report.isError) {
    body = (
      <PulseUnavailable message="Search Console could not be read just now. Try again shortly." />
    );
  } else if (!data?.connected) {
    body = <Skeleton className="h-16" />;
  } else if (data.totals.impressions === 0) {
    body = (
      <PulseUnavailable message="No search data for the last 28 days yet." />
    );
  } else {
    const clicks = percentChange(data.totals.clicks, data.prevTotals.clicks);
    body = (
      <dl className="grid grid-cols-3 gap-3">
        <PulseNumber
          label="Clicks"
          value={pulseCount(data.totals.clicks)}
          title={formatCount(data.totals.clicks)}
          note={
            clicks === null ? null : `${signed(clicks, "%")} vs prior 28 days`
          }
          tone={toneOf(clicks)}
        />
        <PulseNumber
          label="Impressions"
          value={pulseCount(data.totals.impressions)}
          title={formatCount(data.totals.impressions)}
        />
        <PulseNumber
          label="Avg position"
          value={formatPosition(data.totals.position)}
        />
      </dl>
    );
  }

  return (
    <Pulse
      title="Organic Search"
      source="Search Console · 28 days"
      details={
        <p>
          First-party Google Search Console data for the last 28 days, compared
          with the 28 days before. Google reports 2–3 days behind. Third-party
          estimates live in Keywords &amp; SERPs and Site Explorer and are never
          mixed in here.
        </p>
      }
      action={
        <Link
          to="/p/$projectId/search-performance"
          params={{ projectId }}
          className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          Details
        </Link>
      }
    >
      {body}
      <p className="text-xs text-muted-foreground">
        {rank === null
          ? "Rank tracking unavailable"
          : rank.trackers === 0
            ? "Rank tracking not set up"
            : `Rank tracking · ${rank.keywords} keywords${
                rank.lastCheckedAt
                  ? ` · checked ${formatRelativeTime(rank.lastCheckedAt)}`
                  : ""
              }`}
      </p>
    </Pulse>
  );
}

export function CompetitivePulse({
  projectId,
  data,
}: {
  projectId: string;
  data: CommandCentreData;
}) {
  const { opportunities, competitors } = data;
  let body;
  if (competitors === 0 && !opportunities?.competitorGaps) {
    body = (
      <PulseUnavailable
        message="No competitors saved."
        action={
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={
              <Link
                to="/p/$projectId/settings/context"
                params={{ projectId }}
              />
            }
          >
            Add competitors
          </Button>
        }
      />
    );
  } else if (opportunities?.lastObservedAt) {
    body = (
      <dl className="grid grid-cols-3 gap-3">
        <PulseNumber
          label="Competitors"
          value={competitors === null ? "—" : String(competitors)}
          note="saved"
        />
        <PulseNumber
          label="Keyword gaps"
          value={String(opportunities.competitorGaps)}
          note="open"
        />
        <PulseNumber
          label="Citation gaps"
          value={String(opportunities.aiGaps)}
          note="open"
        />
      </dl>
    );
  } else return null;
  return (
    <Pulse
      title="Opportunities"
      source="Opportunity analysis"
      details={
        <p>
          Stored findings from the last opportunity analysis, not a live scan.
          Open counts only include opportunities not yet in progress or
          dismissed.
        </p>
      }
      action={
        <Link
          to="/p/$projectId/domain"
          params={{ projectId }}
          search={{}}
          className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          Site Explorer
        </Link>
      }
    >
      {body}
      {opportunities?.lastObservedAt ? (
        <p className="text-xs text-muted-foreground">
          Last analyzed {formatRelativeTime(opportunities.lastObservedAt)}
        </p>
      ) : null}
    </Pulse>
  );
}
