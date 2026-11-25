import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CardShell } from "@/client/components/CardShell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import {
  cardMetaClass,
  cardTableClass,
  moreDetailsClass,
} from "@/client/features/dashboard/cardParts";
import { MetricsSkeleton } from "@/client/features/dashboard/DashboardMetrics";
import { getGa4AiReferrals } from "@/serverFunctions/ga4";

export function AiReferralsCard({ projectId }: { projectId: string }) {
  const query = useQuery({
    queryKey: ["ga4AiReferrals", projectId],
    queryFn: () => getGa4AiReferrals({ data: { projectId } }),
  });
  const report = query.data;

  return (
    <CardShell
      title="Visits from AI assistants"
      titleInfo={
        <span className={cardMetaClass}>Google Analytics · Last 28 days</span>
      }
      action={
        report && !report.connected ? (
          <Link
            to="/p/$projectId/settings"
            params={{ projectId }}
            hash="google-analytics"
            className={moreDetailsClass}
          >
            Connect Google Analytics
          </Link>
        ) : null
      }
    >
      {query.isError ? (
        <p className="text-sm text-muted-foreground">
          Couldn&rsquo;t load Google Analytics data. Try again shortly.
        </p>
      ) : !report ? (
        <MetricsSkeleton />
      ) : !report.connected ? (
        <p className="text-sm text-muted-foreground">
          Connect Google Analytics to see how many visits arrive from ChatGPT,
          Perplexity, Gemini and other assistants.
        </p>
      ) : report.totalSessions === 0 ? (
        <p className="text-sm text-muted-foreground">
          No visits from an AI assistant were recorded in this period. Visits
          from an assistant that sends no referrer show up as direct traffic and
          are not counted here.
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm">
            <span className="text-2xl font-semibold tabular-nums">
              {report.totalSessions.toLocaleString()}
            </span>{" "}
            <span className="text-muted-foreground">
              sessions from assistants that sent a referrer
            </span>
          </p>
          <div className="space-y-1" aria-label="Sessions per week">
            {report.weeks.map((week) => (
              <div key={week.end} className="flex items-center gap-2 text-xs">
                <span className="w-24 shrink-0 text-muted-foreground tabular-nums">
                  to {week.end.slice(5)}
                </span>
                <div
                  className="h-2 rounded-sm bg-primary"
                  style={{
                    width: `${(week.sessions / Math.max(1, ...report.weeks.map((w) => w.sessions))) * 100}%`,
                  }}
                />
                <span className="tabular-nums">
                  {week.sessions.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
          <Table className={cardTableClass}>
            <TableHeader>
              <TableRow>
                <TableHead>Assistant</TableHead>
                <TableHead className="text-right">Sessions</TableHead>
                <TableHead className="text-right">Engaged</TableHead>
                <TableHead className="text-right">Key events</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.assistants.map((assistant) => (
                <TableRow key={assistant.name}>
                  <TableCell>{assistant.name}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {assistant.sessions.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {assistant.engagedSessions.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {assistant.keyEvents.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {report.pages.length > 0 ? (
            <Table className={cardTableClass}>
              <TableHeader>
                <TableRow>
                  <TableHead>Landing page</TableHead>
                  <TableHead className="text-right">Sessions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.pages.slice(0, 10).map((page) => (
                  <TableRow key={`${page.host}${page.path}`}>
                    <TableCell className="break-all">
                      {page.host}
                      {page.path}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {page.sessions.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </div>
      )}
    </CardShell>
  );
}
