import { QueryState } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/client/components/ui/sheet";
import type {
  getAttributionChangeMovementFn,
  getAttributionKeywordsFn,
} from "@/serverFunctions/attributionSearch";
import type { ReportParams } from "./attributionQueries";
import { formatCredited, moneyLines, shortDate } from "./format";
import { useChangeMovement, useKeywordAssociations } from "./searchAiQueries";

type Keywords = Awaited<ReturnType<typeof getAttributionKeywordsFn>>;
type Movement = Awaited<ReturnType<typeof getAttributionChangeMovementFn>>;

function Keywords({ data }: { data: Keywords }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        Searches that bring people here{" "}
        <Badge variant="secondary">Associated</Badge>
      </h3>
      <p className="text-xs text-muted-foreground">{data.note}</p>
      {data.searchStatus !== "ok" ? (
        <p className="text-sm text-muted-foreground">
          {data.searchStatus === "not_connected"
            ? "Search Console is not connected."
            : "Search Console could not be read just now."}
        </p>
      ) : data.queries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Search Console shows no queries for this page in the period.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 font-normal">Search</th>
              <th className="py-1 text-right font-normal">Clicks</th>
              <th className="py-1 text-right font-normal">Position</th>
              <th className="py-1 text-right font-normal">Est. outcomes</th>
              <th className="py-1 text-right font-normal">Est. revenue</th>
            </tr>
          </thead>
          <tbody>
            {data.queries.map((q) => (
              <tr key={q.query} className="border-t border-border">
                <td className="max-w-44 truncate py-1.5" title={q.query}>
                  {q.query}
                </td>
                <td className="py-1.5 text-right tabular-nums">{q.clicks}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {q.position.toFixed(1)}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {formatCredited(
                    Object.values(q.outcomes).reduce((n, v) => n + v, 0),
                  )}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {q.revenue.length
                    ? moneyLines(q.revenue, data.reportingCurrency).join(" · ")
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data.undivided ? (
        <p className="text-xs text-muted-foreground">
          This page has organic outcomes but Search Console shows no clicks for
          it, so they could not be divided across searches.
        </p>
      ) : null}
    </section>
  );
}

function MovementList({ data }: { data: Movement }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        Changes to this page <Badge variant="outline">{data.label}</Badge>
      </h3>
      <p className="text-xs text-muted-foreground">{data.note}</p>
      {data.changes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No executed change in the Change Ledger targets this page.
        </p>
      ) : (
        data.changes.map((c) => (
          <div
            key={c.entryId}
            className="space-y-1 rounded-lg border border-border p-3 text-sm"
          >
            <p className="font-medium">{c.proposedAction}</p>
            <p className="text-xs text-muted-foreground">
              Executed {c.executedAt ? shortDate(c.executedAt) : ""};{" "}
              {c.windowDays}-day windows
              {c.afterComplete ? "" : ", the after window is not finished"}
            </p>
            <dl className="grid grid-cols-[6rem_1fr_1fr] gap-y-0.5 tabular-nums">
              <dt />
              <dd className="text-xs text-muted-foreground">Before</dd>
              <dd className="text-xs text-muted-foreground">After</dd>
              <dt className="text-muted-foreground">Sessions</dt>
              <dd>
                {c.before.sessions} ({c.before.sessionsPerDay}/day)
              </dd>
              <dd>
                {c.after.sessions} ({c.after.sessionsPerDay}/day)
              </dd>
              <dt className="text-muted-foreground">Outcomes</dt>
              <dd>{formatCredited(c.before.outcomes)}</dd>
              <dd>{formatCredited(c.after.outcomes)}</dd>
              <dt className="text-muted-foreground">Revenue</dt>
              <dd>
                {c.before.revenue.length
                  ? moneyLines(c.before.revenue, data.reportingCurrency).join(
                      " · ",
                    )
                  : "—"}
              </dd>
              <dd>
                {c.after.revenue.length
                  ? moneyLines(c.after.revenue, data.reportingCurrency).join(
                      " · ",
                    )
                  : "—"}
              </dd>
            </dl>
            {c.overlapping.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {c.overlapping.length} other change
                {c.overlapping.length === 1 ? "" : "s"} to this page fall inside
                these windows.
              </p>
            ) : null}
          </div>
        ))
      )}
    </section>
  );
}

/** One landing page: the searches behind it and what changed on it. */
export function PageDetailSheet({
  params,
  page,
  onClose,
}: {
  params: ReportParams;
  page: { host: string; path: string } | null;
  onClose: () => void;
}) {
  const keywords = useKeywordAssociations(params, page);
  const movement = useChangeMovement(params, page);
  return (
    <Sheet open={Boolean(page)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="break-all">{page?.path}</SheetTitle>
          <SheetDescription>{page?.host}</SheetDescription>
        </SheetHeader>
        <div className="space-y-6 px-4 pb-6">
          <QueryState
            query={keywords}
            errorFallback="Could not load searches"
            loading={<Skeleton className="h-32" />}
          >
            {(data) => <Keywords data={data} />}
          </QueryState>
          <QueryState
            query={movement}
            errorFallback="Could not load changes"
            loading={<Skeleton className="h-32" />}
          >
            {(data) => <MovementList data={data} />}
          </QueryState>
        </div>
      </SheetContent>
    </Sheet>
  );
}
