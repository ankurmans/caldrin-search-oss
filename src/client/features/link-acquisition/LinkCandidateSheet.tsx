import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SafeExternalLink } from "@/client/components/SafeExternalLink";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/client/components/ui/sheet";
import { formatCompactDate } from "@/client/features/backlinks/backlinksPageUtils";
import { formatNumber } from "@/client/features/keywords/utils";
import { plainReason } from "@/client/features/spend/costText";
import { useCostDisplay } from "@/client/features/spend/useCostDisplay";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  estimateLinkEvidence,
  runLinkEvidence,
} from "@/serverFunctions/link-acquisition";
import {
  linkGapKeys,
  RECOMMENDATION_VARIANT,
  recommendationLabel,
  type LinkGapRow,
} from "./linkGap";

const MISSING = "Not reported";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function Paragraph({ label, children }: { label: string; children: string }) {
  return (
    <div>
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </h3>
      <p className="text-sm">{children}</p>
    </div>
  );
}

function EvidenceRead({
  projectId,
  runId,
  domain,
}: {
  projectId: string;
  runId: string;
  domain: string;
}) {
  const queryClient = useQueryClient();
  const { showCosts, cost } = useCostDisplay();
  const input = { runId, domains: [domain] };
  const estimate = useMutation({
    mutationFn: () => estimateLinkEvidence({ data: { projectId, input } }),
    onError: (error) => toast.error(getStandardErrorMessage(error, "Failed")),
  });
  const run = useMutation({
    mutationFn: () => runLinkEvidence({ data: { projectId, input } }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(plainReason(result.reason, showCosts));
        return;
      }
      toast.success(
        `${result.data.evidenceRows} linking pages stored${cost(result.data.costUsd) ? ` for ${cost(result.data.costUsd)}` : ""}`,
      );
      estimate.reset();
      void queryClient.invalidateQueries({
        queryKey: linkGapKeys.table(projectId),
      });
    },
    onError: (error) => toast.error(getStandardErrorMessage(error, "Failed")),
  });

  const quote = estimate.data;
  if (!quote) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={estimate.isPending}
        onClick={() => estimate.mutate()}
      >
        {estimate.isPending ? <Spinner /> : null}
        {showCosts ? "Preview cost to read exact pages" : "Read exact pages"}
      </Button>
    );
  }
  if (!quote.ok)
    return (
      <p role="alert" className="text-sm">
        {plainReason(quote.reason, showCosts)}
      </p>
    );
  const { data } = quote;
  if (!data.available) {
    return (
      <p role="alert" className="text-sm">
        {plainReason(data.reason, showCosts)}
      </p>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
      <p>
        {showCosts
          ? `Up to ${cost(data.estimatedUsd)}: ${data.basis}`
          : "Reads the pages that link to your competitors from this site."}
      </p>
      <div className="flex gap-2">
        <Button size="sm" disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? <Spinner /> : null}
          {showCosts
            ? `Read for up to ${cost(data.estimatedUsd)}`
            : "Read pages"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => estimate.reset()}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function LinkCandidateSheet({
  projectId,
  runId,
  row,
  onClose,
}: {
  projectId: string;
  runId: string;
  row: LinkGapRow | null;
  onClose: () => void;
}) {
  const q = row?.qualification;
  return (
    <Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {row && q ? (
          <>
            <SheetHeader>
              <SheetTitle className="break-all">
                {row.referringDomain}
              </SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2">
                <Badge variant={RECOMMENDATION_VARIANT[q.recommendation]}>
                  {recommendationLabel(q.recommendation)}
                </Badge>
                Score {Math.round(q.score)} of 100, {q.confidence} confidence
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-4 pb-6">
              <div className="space-y-3">
                <Paragraph label="Why found">{q.whyFound}</Paragraph>
                <Paragraph label="Why relevant">{q.whyRelevant}</Paragraph>
                <Paragraph label="Why realistic">{q.whyRealistic}</Paragraph>
                <Paragraph label="Next action">{q.nextAction}</Paragraph>
              </div>

              <section>
                <h3 className="mb-1 text-sm font-semibold">How it scored</h3>
                <ul className="divide-y rounded-lg border text-sm">
                  {q.factors.map((factor) => (
                    <li key={factor.factor} className="space-y-0.5 p-2.5">
                      <div className="flex justify-between gap-3 font-medium">
                        <span>{factor.factor}</span>
                        <span className="tabular-nums">
                          {factor.points} / {factor.max}
                        </span>
                      </div>
                      <p className="text-muted-foreground">{factor.detail}</p>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-muted-foreground">
                  Weights and thresholds are editable under Qualification
                  settings. Domain Rank and spam score move points; they never
                  exclude a site on their own.
                </p>
              </section>

              {q.limitations.length > 0 ? (
                <section>
                  <h3 className="mb-1 text-sm font-semibold">
                    What this does not show
                  </h3>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {q.limitations.map((limit) => (
                      <li key={limit}>{limit}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section>
                <h3 className="mb-1 text-sm font-semibold">
                  Competitors this site links to
                </h3>
                <p className="mb-2 text-xs text-muted-foreground">
                  Aggregate counts from the provider&apos;s domain intersection.
                  They describe the domain, not a specific page.
                </p>
                <div className="space-y-2">
                  {row.competitors.map((competitor) => (
                    <div
                      key={competitor.competitorDomain}
                      className="rounded-lg border p-2.5"
                    >
                      <p className="font-medium break-all">
                        {competitor.competitorDomain}
                      </p>
                      <dl className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        <Fact
                          label="Links"
                          value={formatNumber(competitor.backlinks)}
                        />
                        <Fact
                          label="Linking pages"
                          value={formatNumber(competitor.referringPages)}
                        />
                        <Fact
                          label="Nofollow pages"
                          value={formatNumber(competitor.nofollowPages)}
                        />
                        <Fact
                          label="Domain Rank"
                          value={formatNumber(competitor.domainRank)}
                        />
                        <Fact
                          label="First seen"
                          value={formatCompactDate(competitor.firstSeen)}
                        />
                        <Fact
                          label="Lost"
                          value={
                            competitor.lostDate
                              ? formatCompactDate(competitor.lostDate)
                              : "No"
                          }
                        />
                        <Fact
                          label="Site type"
                          value={competitor.topPlatform ?? MISSING}
                        />
                        <Fact
                          label="Usual placement"
                          value={competitor.topPlacement ?? MISSING}
                        />
                      </dl>
                    </div>
                  ))}
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Exact linking pages</h3>
                {row.evidence.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Not read yet. The gap only has counts for this domain.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {row.evidence.map((item) => (
                      <li
                        key={item.id}
                        className="rounded-lg border p-2.5 text-sm"
                      >
                        <SafeExternalLink
                          url={item.urlFrom}
                          label={item.pageTitle ?? item.urlFrom}
                          className="font-medium break-all underline-offset-4 hover:underline"
                        />
                        <p className="text-xs text-muted-foreground break-all">
                          Links to {item.urlTo}
                          {item.competitorDomain
                            ? ` (competitor ${item.competitorDomain})`
                            : ""}
                        </p>
                        <p className="mt-1">
                          Anchor: {item.anchor ?? MISSING}
                          {item.semanticLocation
                            ? `, placement: ${item.semanticLocation}`
                            : ""}
                        </p>
                        {item.textBefore || item.textAfter ? (
                          <p className="mt-1 text-muted-foreground">
                            …{item.textBefore ?? ""}{" "}
                            <strong>{item.anchor ?? ""}</strong>{" "}
                            {item.textAfter ?? ""}…
                          </p>
                        ) : null}
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {item.isSponsored ? (
                            <Badge variant="warning">Sponsored</Badge>
                          ) : null}
                          {item.isUgc ? (
                            <Badge variant="outline">UGC</Badge>
                          ) : null}
                          <Badge variant="outline">
                            {item.isNofollow ? "Nofollow" : "Follow"}
                          </Badge>
                          {item.pageLanguage ? (
                            <Badge variant="outline">{item.pageLanguage}</Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Provider data collected{" "}
                          {formatCompactDate(item.collectedAt)}; last seen{" "}
                          {formatCompactDate(item.lastSeen)}.
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                <EvidenceRead
                  projectId={projectId}
                  runId={runId}
                  domain={row.referringDomain}
                />
              </section>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
