import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CardShell } from "@/client/components/CardShell";
import { QueryState } from "@/client/components/QueryState";
import { Button } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { CrawlerPathTable } from "./CrawlerPathTable";
import { AccessCard } from "@/client/features/ai-crawlers/AccessCard";
import { VisitsSetup } from "@/client/features/ai-crawlers/VisitsSetup";
import { getAiCrawlerActivity } from "@/serverFunctions/ai-crawlers";

const WINDOWS = [7, 28, 90] as const;

const crawlerKey = (projectId: string, part: string, ...rest: unknown[]) =>
  ["ai-crawlers", projectId, part, ...rest] as const;

export function AiCrawlersPage({ projectId }: { projectId: string }) {
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(28);
  return (
    <div className="px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">AI crawlers</h1>
          <p className="text-sm text-muted-foreground">
            Which AI crawlers your robots.txt lets in, and, if you connect your
            hosting, which ones visit. Visits are identified by user agent only,
            so treat them as claims.
          </p>
        </header>
        <AccessCard projectId={projectId} />
        <ActivityCard projectId={projectId} days={days} onDays={setDays} />
        <VisitsSetup projectId={projectId} />
      </div>
    </div>
  );
}

function ActivityCard({
  projectId,
  days,
  onDays,
}: {
  projectId: string;
  days: (typeof WINDOWS)[number];
  onDays: (days: (typeof WINDOWS)[number]) => void;
}) {
  const query = useQuery({
    queryKey: crawlerKey(projectId, "activity", days),
    queryFn: () => getAiCrawlerActivity({ data: { projectId, days } }),
  });
  return (
    <CardShell
      title="Visits"
      action={
        <div className="flex gap-1" role="group" aria-label="Window">
          {WINDOWS.map((d) => (
            <Button
              key={d}
              size="xs"
              variant={days === d ? "default" : "outline"}
              onClick={() => onDays(d)}
            >
              {d} days
            </Button>
          ))}
        </div>
      }
    >
      <QueryState
        query={query}
        loading={<Skeleton className="h-40 w-full" />}
        errorFallback="Failed to load crawler visits"
      >
        {(data) =>
          !data.source ? (
            <p className="text-sm text-muted-foreground">
              No visit source is connected yet, so there is no visit data. That
              is not the same as no visits. Connect Cloudflare below.
            </p>
          ) : data.totalHits === 0 ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                No visits claiming to be an AI crawler in the last {days} days.
                {data.source === "snippet"
                  ? data.lastVisitSeenAt
                    ? ` The snippet last reported a visit on ${data.lastVisitSeenAt.slice(0, 10)}.`
                    : " The snippet has not reported a visit yet."
                  : ""}
              </p>
              {data.pathDiagnostics.length ? (
                <CrawlerPathTable rows={data.pathDiagnostics} />
              ) : null}
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-col gap-2">
                <p className="text-sm">
                  <span className="text-2xl font-semibold tabular-nums">
                    {data.totalHits.toLocaleString()}
                  </span>{" "}
                  visits in {days} days
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Crawler</TableHead>
                      <TableHead className="text-right">Visits</TableHead>
                      <TableHead className="text-right">Errors</TableHead>
                      <TableHead>Last seen</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.bots.map((bot) => (
                      <TableRow key={bot.token}>
                        <TableCell className="font-medium">
                          {bot.token}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {bot.hits}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {bot.errorHits}
                        </TableCell>
                        <TableCell>{bot.lastDay}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div>
                <CrawlerPathTable rows={data.pathDiagnostics} />
              </div>
              <p className="text-xs text-muted-foreground">{data.caveat}</p>
            </div>
          )
        }
      </QueryState>
    </CardShell>
  );
}
