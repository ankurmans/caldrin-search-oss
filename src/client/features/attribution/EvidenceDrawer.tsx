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
import { formatMoney } from "@/shared/attribution/money";
import { MODEL_LABELS } from "@/shared/attribution/vocabulary";
import type { getConversionEvidenceFn } from "@/serverFunctions/attributionReports";
import { EvidenceBadge } from "./EvidenceBadge";
import { channelLabel, percent, shortDate } from "./format";
import { useConversionEvidence } from "./attributionQueries";

type Evidence = NonNullable<
  Awaited<ReturnType<typeof getConversionEvidenceFn>>
>;

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function Details({ evidence }: { evidence: Evidence }) {
  const { conversion, event, run } = evidence;
  return (
    <div className="space-y-6 text-sm">
      {evidence.notes.length > 0 ? (
        <ul className="space-y-1 rounded-lg border border-border bg-muted/50 p-3">
          {evidence.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}

      <Section title="The outcome">
        <dl className="grid grid-cols-[8rem_1fr] gap-y-1">
          <dt className="text-muted-foreground">Kind</dt>
          <dd>
            {conversion.kind.replace("_", " ")}
            {conversion.isDemo ? <Badge className="ml-2">Demo</Badge> : null}
          </dd>
          <dt className="text-muted-foreground">When</dt>
          <dd>{shortDate(conversion.occurredAt)}</dd>
          {conversion.amountMinor != null && conversion.currency ? (
            <>
              <dt className="text-muted-foreground">Amount</dt>
              <dd>
                {formatMoney(conversion.amountMinor, conversion.currency)}
                {conversion.grossMinor !== conversion.amountMinor &&
                conversion.grossMinor != null
                  ? ` (${formatMoney(conversion.grossMinor, conversion.currency)} before refunds)`
                  : ""}
              </dd>
            </>
          ) : null}
        </dl>
      </Section>

      {event ? (
        <Section title="Reported by">
          <dl className="grid grid-cols-[8rem_1fr] gap-y-1">
            <dt className="text-muted-foreground">System</dt>
            <dd>
              {event.sourceSystem} ({event.origin})
            </dd>
            <dt className="text-muted-foreground">Their id</dt>
            <dd className="break-all font-mono text-xs">
              {event.sourceEventId}
            </dd>
            <dt className="text-muted-foreground">Received</dt>
            <dd>{shortDate(event.ingestedAt)}</dd>
            {event.batch ? (
              <>
                <dt className="text-muted-foreground">Import</dt>
                <dd>{event.batch.label}</dd>
              </>
            ) : null}
            {event.selfReportedSource ? (
              <>
                <dt className="text-muted-foreground">They said</dt>
                <dd>“{event.selfReportedSource}”</dd>
              </>
            ) : null}
          </dl>
        </Section>
      ) : null}

      <Section title="Identities joined">
        {evidence.identities.length === 0 ? (
          <p className="text-muted-foreground">
            This event carried no identifier, so nothing could be joined to it.
          </p>
        ) : (
          <ul className="space-y-1">
            {evidence.identities.map((i) => (
              <li key={`${i.type}:${i.value}`} className="break-all">
                <span className="text-muted-foreground">{i.type}</span>{" "}
                <span className="font-mono text-xs">{i.value}</span>
              </li>
            ))}
          </ul>
        )}
        {evidence.links.map((l) => (
          <p key={l.id} className="text-xs text-muted-foreground">
            <Badge
              variant={l.status === "conflict" ? "warning" : "outline"}
              className="mr-1.5"
            >
              {l.status === "conflict" ? "Refused" : "Joined"}
            </Badge>
            {l.reason}
          </p>
        ))}
      </Section>

      <Section
        title={`Visits considered${run ? ` (last ${run.lookbackDays} days)` : ""}`}
      >
        {evidence.touchpoints.length === 0 ? (
          <p className="text-muted-foreground">None were recorded.</p>
        ) : (
          <ol className="space-y-2">
            {evidence.touchpoints.map((t) => (
              <li key={t.id} className="rounded-lg border border-border p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{channelLabel(t.channel)}</span>
                  {t.source ? <span>{t.source}</span> : null}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {shortDate(t.occurredAt)}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {t.landing ? `Landed on ${t.landing}. ` : ""}
                  {t.referrerHost ? `From ${t.referrerHost}. ` : ""}
                  {t.campaign ? `Campaign ${t.campaign}. ` : ""}
                  {t.selfReportedText
                    ? `They wrote “${t.selfReportedText}”. `
                    : ""}
                  {t.sharedId
                    ? "Same id as the outcome. "
                    : "Joined through another id. "}
                  Classified by rule{" "}
                  <span className="font-mono">{t.ruleId}</span>.
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title="What each model credits">
        <div className="space-y-2">
          {evidence.models.map((m) => (
            <div key={m.model} className="grid grid-cols-[9rem_1fr] gap-2">
              <span className="text-muted-foreground">
                {MODEL_LABELS[m.model]}
              </span>
              <div className="space-y-1">
                {m.credits.map((c, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <span>
                      {channelLabel(c.channel)}
                      {c.source ? ` · ${c.source}` : ""}
                    </span>
                    <span className="tabular-nums">{percent(c.bp)}</span>
                    <EvidenceBadge evidence={c.evidence} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {run ? (
          <p className="text-xs text-muted-foreground">
            Model version {run.modelVersion}, {run.lookbackDays}-day lookback,
            set {shortDate(run.createdAt)} ({run.reason.replace("_", " ")}).
          </p>
        ) : null}
      </Section>
    </div>
  );
}

/** Everything behind one credit: the event, the joins, the visits and each model's answer. */
export function EvidenceDrawer({
  projectId,
  conversionId,
  onClose,
}: {
  projectId: string;
  conversionId: string | undefined;
  onClose: () => void;
}) {
  const query = useConversionEvidence(projectId, conversionId);
  return (
    <Sheet
      open={Boolean(conversionId)}
      onOpenChange={(open) => !open && onClose()}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Evidence</SheetTitle>
          <SheetDescription>
            What this credit was worked out from. Nothing here is estimated for
            display.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          <QueryState
            query={query}
            loading={<Skeleton className="h-64 w-full" />}
            errorFallback="Failed to load the evidence"
          >
            {(evidence) =>
              evidence ? (
                <Details evidence={evidence} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  This outcome no longer exists. It may have been removed with
                  an import.
                </p>
              )
            }
          </QueryState>
        </div>
      </SheetContent>
    </Sheet>
  );
}
