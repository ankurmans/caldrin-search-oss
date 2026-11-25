import {
  getDomainAnalytics,
  getDomainSearchConsole,
} from "@/serverFunctions/domain";
import {
  Frame,
  Message,
  SourceCard,
  Stat,
  percent,
  percentChange,
  pointsChange,
  positionChange,
  useFirstParty,
  type Input,
} from "@/client/features/domain/components/overview/FirstPartyShared";
import { SourceNote } from "@/client/features/domain/components/overview/SourceNote";
import { formatNumber } from "@/client/features/domain/utils";

export function SearchConsoleCard({ input }: { input: Input }) {
  const query = useFirstParty("search-console", input, (data) =>
    getDomainSearchConsole({ data }),
  );
  return (
    <SourceCard
      query={query}
      title="Search Console"
      projectId={input.projectId}
      connectLabel="Search Console"
    >
      {(data) =>
        data.status !== "ok" ? null : (
          <Frame
            title="Search Console"
            note={
              <SourceNote
                source={`Search Console actuals, ${data.startDate} to ${data.endDate}`}
                date={null}
              />
            }
          >
            <div className="grid grid-cols-2 gap-3">
              <Stat
                label="Clicks"
                value={formatNumber(data.totals.clicks)}
                change={percentChange(
                  data.totals.clicks,
                  data.previousTotals.clicks,
                )}
              />
              <Stat
                label="Impressions"
                value={formatNumber(data.totals.impressions)}
                change={percentChange(
                  data.totals.impressions,
                  data.previousTotals.impressions,
                )}
              />
              <Stat
                label="CTR"
                value={percent(data.totals.ctr)}
                change={pointsChange(
                  (data.totals.ctr - data.previousTotals.ctr) * 100,
                )}
              />
              <Stat
                label="Average position"
                value={data.totals.position.toFixed(1)}
                change={positionChange(
                  data.totals.position,
                  data.previousTotals.position,
                )}
              />
            </div>
            {data.branded && data.nonBranded ? (
              <table className="w-full text-sm">
                <caption className="pb-1 text-left text-xs text-muted-foreground">
                  Queries containing &quot;{data.brandTerm}&quot; against all
                  others. Anonymised queries are in neither row.
                </caption>
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 text-left font-normal" />
                    <th className="py-1 text-right font-normal">Clicks</th>
                    <th className="py-1 text-right font-normal">Impressions</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Branded", data.branded],
                    ["Non-branded", data.nonBranded],
                  ].map(([label, row]) =>
                    typeof label === "string" && typeof row === "object" ? (
                      <tr key={label} className="border-t border-border">
                        <td className="py-1.5">{label}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {formatNumber(row.clicks)}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {formatNumber(row.impressions)}
                        </td>
                      </tr>
                    ) : null,
                  )}
                </tbody>
              </table>
            ) : (
              <Message>
                Set a brand name on the project to split branded from
                non-branded queries.
              </Message>
            )}
          </Frame>
        )
      }
    </SourceCard>
  );
}

export function AnalyticsCard({ input }: { input: Input }) {
  const query = useFirstParty("analytics", input, (data) =>
    getDomainAnalytics({ data }),
  );
  return (
    <SourceCard
      query={query}
      title="Google Analytics"
      projectId={input.projectId}
      connectLabel="Google Analytics"
    >
      {(data) =>
        data.status !== "ok" ? null : (
          <Frame
            title="Google Analytics, organic search"
            note={
              <SourceNote
                source={`GA4 actuals, ${data.startDate} to ${data.endDate}`}
                date={null}
              />
            }
          >
            <div className="grid grid-cols-2 gap-3">
              <Stat
                label="Organic sessions"
                value={formatNumber(data.sessions.current)}
                change={percentChange(
                  data.sessions.current,
                  data.sessions.previous,
                )}
              />
              <Stat
                label="Active users"
                value={formatNumber(data.activeUsers.current)}
                change={percentChange(
                  data.activeUsers.current,
                  data.activeUsers.previous,
                )}
              />
              <Stat
                label="Engagement rate"
                value={percent(data.engagementRate.current)}
                change={
                  data.engagementRate.current == null ||
                  data.engagementRate.previous == null
                    ? null
                    : pointsChange(
                        (data.engagementRate.current -
                          data.engagementRate.previous) *
                          100,
                      )
                }
              />
              <Stat
                label="Key events"
                value={formatNumber(data.keyEvents.current)}
                change={percentChange(
                  data.keyEvents.current,
                  data.keyEvents.previous,
                )}
              />
            </div>
            {data.landingPages.length === 0 ? (
              <Message>No organic landing pages in this period.</Message>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 text-left font-normal">
                      Top landing pages
                    </th>
                    <th className="py-1 text-right font-normal">Sessions</th>
                    <th className="py-1 text-right font-normal">Engaged</th>
                  </tr>
                </thead>
                <tbody>
                  {data.landingPages.map((page) => (
                    <tr
                      key={`${page.host}${page.path}`}
                      className="border-t border-border"
                    >
                      <td className="max-w-0 truncate py-1.5" title={page.path}>
                        {page.path}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatNumber(page.sessions)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {percent(page.engagementRate, 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Frame>
        )
      }
    </SourceCard>
  );
}
