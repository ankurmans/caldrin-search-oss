import { Badge } from "@/client/components/ui/badge";
import { QueryState } from "@/client/components/QueryState";
import { Skeleton } from "@/client/components/ui/skeleton";
import { useCallsReport, type ReportParams } from "./attributionQueries";
import {
  channelLabel,
  formatCredited,
  moneyLines,
  shortDate,
  STAGE_LABELS,
} from "./format";

/** Calls by outcome and source, with the 60-second figure labelled as the proxy it is. */
export function CallsPanel({ params }: { params: ReportParams }) {
  const query = useCallsReport(params);
  return (
    <QueryState
      query={query}
      errorFallback="Could not load calls"
      loading={<Skeleton className="h-24 w-full" />}
    >
      {(calls) =>
        calls.totals.calls === 0 ? null : (
          <section className="space-y-3">
            <h2 className="text-base font-semibold">Calls</h2>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {[
                ["Calls", calls.totals.calls],
                ["Answered", calls.totals.answered],
                ["Missed", calls.totals.missed],
                ["Voicemail", calls.totals.voicemail],
                ["Abandoned", calls.totals.abandoned],
                ["Handoff failed", calls.totals.handoffFailed],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-lg border bg-card px-3 py-2"
                >
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-sm">
              <Badge variant="warning">Proxy</Badge>{" "}
              {calls.totals.conversationProxy} answered calls ran{" "}
              {calls.proxySeconds} seconds or more.
            </p>
            {calls.bySource.length ? (
              <ul className="flex flex-wrap gap-2 text-sm">
                {calls.bySource.map((s) => (
                  <li key={`${s.channel}|${s.source}`}>
                    <Badge variant="outline">
                      {s.source ?? channelLabel(s.channel)} ·{" "}
                      {formatCredited(s.calls)}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-sm text-muted-foreground">
              {calls.tiedToOutcomes.callers} callers were matched to a person by
              an id your systems sent
              {calls.tiedToOutcomes.callers
                ? `: ${Object.entries(calls.tiedToOutcomes.byStage)
                    .map(([stage, n]) => `${n} ${STAGE_LABELS[stage] ?? stage}`)
                    .join(", ")}`
                : ""}
              {calls.tiedToOutcomes.contract.length
                ? `, ${moneyLines(calls.tiedToOutcomes.contract, calls.reportingCurrency).join(" · ")} won`
                : ""}
              . The rest cannot be followed.
            </p>
            {calls.needsFollowUp.length ? (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium">
                  Missed, abandoned or mishandled calls (
                  {calls.needsFollowUp.length} most recent)
                </summary>
                <ul className="mt-2 space-y-1">
                  {calls.needsFollowUp.map((c, i) => (
                    <li key={`${c.occurredAt}-${c.status}-${c.source}-${i}`}>
                      {shortDate(c.occurredAt)} · {c.status ?? "answered"}
                      {c.handoff === "failed" ? " · handoff failed" : ""}
                      {c.source ? ` · ${c.source}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            <p className="text-xs text-muted-foreground">{calls.note}</p>
          </section>
        )
      }
    </QueryState>
  );
}
