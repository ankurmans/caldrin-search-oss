import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { QueryError } from "@/client/components/QueryState";
import { SkeletonCard } from "@/client/components/SkeletonPresets";
import { Badge } from "@/client/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/client/components/ui/sheet";
import { getLedgerEntry } from "@/serverFunctions/ledger";
import { AiVisibilityPanel } from "./AiVisibilityPanel";
import { LedgerActions } from "./LedgerActions";
import {
  CostsSection,
  EvidenceSection,
  OverviewSection,
  StatesSection,
} from "./LedgerSections";
import { ObservationsPanel } from "./ObservationsPanel";
import {
  STATUS_LABELS,
  humanize,
  ledgerEntryKey,
  statusVariant,
} from "./helpers";

export function LedgerDetailSheet({
  projectId,
  entryId,
  onClose,
}: {
  projectId: string;
  entryId: string | null;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={entryId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="w-full overflow-y-auto data-[side=right]:sm:max-w-3xl">
        {entryId ? (
          <DetailLoader projectId={projectId} entryId={entryId} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DetailLoader({
  projectId,
  entryId,
}: {
  projectId: string;
  entryId: string;
}) {
  const query = useQuery({
    queryKey: ledgerEntryKey(projectId, entryId),
    queryFn: async () => {
      const result = await getLedgerEntry({ data: { projectId, entryId } });
      if (!result.ok) throw new Error(result.reason);
      return result.data;
    },
  });
  if (query.isPending) {
    return (
      <div className="p-4">
        <SheetTitle className="sr-only">Loading change</SheetTitle>
        <SkeletonCard />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="p-4">
        <SheetTitle className="sr-only">Change unavailable</SheetTitle>
        <QueryError
          error={query.error}
          fallback="Could not load this change."
          onRetry={() => void query.refetch()}
          isRetrying={query.isFetching}
        />
      </div>
    );
  }
  return <DetailBody projectId={projectId} detail={query.data} />;
}

function DetailBody({
  projectId,
  detail,
}: {
  projectId: string;
  detail: Extract<
    Awaited<ReturnType<typeof getLedgerEntry>>,
    { ok: true }
  >["data"];
}) {
  const { entry, finding, followUp } = detail;
  const replay = detail.evidence.filter(
    (item) =>
      item.label === "Experimental, simulated replay" ||
      item.label === "Replay result",
  );
  return (
    <>
      <SheetHeader className="gap-2 border-b pr-12">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={statusVariant(entry.status)}>
            {STATUS_LABELS[entry.status] ?? entry.status}
          </Badge>
          <Badge variant="outline">{humanize(entry.kind)}</Badge>
          <Badge variant="secondary">{humanize(entry.provider)}</Badge>
        </div>
        <SheetTitle>{entry.proposedAction}</SheetTitle>
        <SheetDescription>
          Everything below is what was recorded for this change. Observations
          are readings taken before and after, not proof of cause.
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-8 px-4 pb-8">
        <LedgerActions projectId={projectId} entry={entry} />
        <OverviewSection entry={entry} />
        {finding || entry.contentAssetId ? (
          <section
            className="space-y-2 rounded-xl border p-4 text-sm"
            aria-label="Editorial history"
          >
            <h3 className="font-medium">Editorial history</h3>
            {finding ? (
              <Link
                to="/p/$projectId/opportunities"
                params={{ projectId }}
                search={{ opportunity: finding.id }}
                className="block underline underline-offset-2"
              >
                {finding.query}
              </Link>
            ) : null}
            {entry.contentAssetId ? (
              <Link
                to="/p/$projectId/content"
                params={{ projectId }}
                search={{
                  draft: entry.contentAssetId,
                  revision: entry.contentRevision ?? undefined,
                }}
                className="block underline underline-offset-2"
              >
                Open draft · Change tied to revision{" "}
                {entry.contentRevision ?? "unknown"}
              </Link>
            ) : null}
            {entry.approvedAt ? (
              <p>
                Approved {entry.approvedAt.slice(0, 10)} · Revision{" "}
                {entry.approvedRevision ?? entry.contentRevision ?? "unknown"}
              </p>
            ) : null}
            {entry.publicationStatus === "published" &&
            entry.targetUrl &&
            /^https?:\/\//i.test(entry.targetUrl) ? (
              <a
                className="block underline"
                href={entry.targetUrl}
                target="_blank"
                rel="noreferrer"
              >
                Verified page {entry.executedAt?.slice(0, 10)}
              </a>
            ) : null}
            {entry.rolledBackAt ? (
              <p>Rolled back {entry.rolledBackAt.slice(0, 10)}</p>
            ) : null}
          </section>
        ) : null}
        {replay.length ? (
          <section className="space-y-1 rounded-xl border p-4 text-sm">
            <h3 className="font-medium">Controlled replay</h3>
            {replay.map((item) => (
              <p key={item.id} className="text-muted-foreground">
                {item.value}
              </p>
            ))}
          </section>
        ) : null}
        <EvidenceSection evidence={detail.evidence} />
        <StatesSection entry={entry} />
        <ObservationsPanel
          projectId={projectId}
          entry={entry}
          observations={detail.observations}
          attributionNote={detail.attributionNote}
        />
        <AiVisibilityPanel projectId={projectId} entry={entry} />
        {followUp ? (
          <section
            aria-label="First-party follow-up"
            className="space-y-2 text-sm"
          >
            <h3 className="font-medium">First-party follow-up</h3>
            {followUp.status === "unavailable" ? (
              <p className="text-muted-foreground">{followUp.note}</p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Landing-page sessions and attributed conversion credit ·{" "}
                  {humanize(followUp.model)}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {followUp.windows.map((window, index) => (
                    <div key={window.from} className="rounded-lg border p-3">
                      <h4 className="font-medium">
                        {index === 0 ? "Before" : "After"}
                      </h4>
                      <p className="text-xs text-muted-foreground">
                        {window.from.slice(0, 10)} to {window.to.slice(0, 10)}{" "}
                        (exclusive UTC)
                      </p>
                      <p>{window.sessions} sessions</p>
                      {window.credits.length ? (
                        window.credits.map((item) => (
                          <p key={item.key} className="text-xs">
                            {humanize(item.key)} ·{" "}
                            {item.value.toLocaleString(undefined, {
                              maximumFractionDigits: 2,
                            })}
                          </p>
                        ))
                      ) : (
                        <p className="text-muted-foreground">
                          No conversion credit recorded
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        ) : null}
        <CostsSection costs={detail.costs} />
      </div>
    </>
  );
}
