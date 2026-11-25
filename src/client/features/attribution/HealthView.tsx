import { CircleAlert, CircleCheck, CircleSlash } from "lucide-react";
import { QueryState } from "@/client/components/QueryState";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { Badge } from "@/client/components/ui/badge";
import type { getAttributionHealthFn } from "@/serverFunctions/attributionReports";
import { shortDate } from "./format";
import { useAttributionHealth } from "./attributionQueries";

type Health = Awaited<ReturnType<typeof getAttributionHealthFn>>;

const ICONS = {
  ok: <CircleCheck className="size-4 text-success" aria-label="Working" />,
  attention: (
    <CircleAlert className="size-4 text-warning" aria-label="Needs attention" />
  ),
  off: (
    <CircleSlash
      className="size-4 text-muted-foreground"
      aria-label="Not set up"
    />
  ),
} as const;

function Body({ health }: { health: Health }) {
  return (
    <div className="space-y-8">
      <ul className="grid items-start gap-3 md:grid-cols-2">
        {health.checks.map((c) => (
          <li
            key={c.id}
            className="flex gap-3 rounded-xl border border-border bg-card p-4"
          >
            <span className="mt-0.5 shrink-0">{ICONS[c.status]}</span>
            <div className="min-w-0">
              <div className="text-sm font-medium">{c.label}</div>
              <p className="text-sm text-muted-foreground">{c.detail}</p>
            </div>
          </li>
        ))}
      </ul>

      {health.sources.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">
            What arrived in the last 7 days
          </h2>
          <TableCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>System</TableHead>
                  <TableHead>How</TableHead>
                  <TableHead className="text-right">Events</TableHead>
                  <TableHead className="text-right">Tests</TableHead>
                  <TableHead className="text-right">Bots</TableHead>
                  <TableHead>Latest</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {health.sources.map((s) => (
                  <TableRow key={`${s.sourceSystem}-${s.origin}`}>
                    <TableCell>{s.sourceSystem}</TableCell>
                    <TableCell>{s.origin}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.count}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.tests}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.bots}
                    </TableCell>
                    <TableCell>{shortDate(s.latest)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        </section>
      ) : null}

      {health.batches.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">
            Recent imports and deliveries
          </h2>
          <TableCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Import</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead className="text-right">Added</TableHead>
                  <TableHead className="text-right">Already held</TableHead>
                  <TableHead className="text-right">Refused</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {health.batches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      {b.label}
                      {b.isDemo ? <Badge className="ml-2">Demo</Badge> : null}
                    </TableCell>
                    <TableCell>{shortDate(b.createdAt)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {b.accepted}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {b.duplicate}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {b.rejected}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        </section>
      ) : null}
    </div>
  );
}

export function HealthView({
  projectId,
  demo,
}: {
  projectId: string;
  demo: boolean;
}) {
  const query = useAttributionHealth(projectId, demo);
  return (
    <QueryState
      query={query}
      loading={<Skeleton className="h-64 w-full" />}
      errorFallback="Failed to load attribution health"
    >
      {(health) => <Body health={health} />}
    </QueryState>
  );
}
