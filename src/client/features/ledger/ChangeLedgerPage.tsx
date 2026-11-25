import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader, SectionHeader } from "@/client/components/PageHeader";
import { QueryState } from "@/client/components/QueryState";
import { SkeletonCard } from "@/client/components/SkeletonPresets";
import { getLedgerEntries } from "@/serverFunctions/ledger";
import { getSpendOverview } from "@/serverFunctions/spend";
import { LedgerDetailSheet } from "./LedgerDetailSheet";
import { LedgerList, type StatusFilter } from "./LedgerList";
import { Button } from "@/client/components/ui/button";
import type { LedgerEntryWithNames } from "@/server/features/ledger/types";
import { formatUsd, ledgerListKey, spendKey } from "./helpers";

// Limits and totals live in Project Settings; this keeps the month's spend in
// view without the full form.
function SpendIndicator({ projectId }: { projectId: string }) {
  const { data } = useQuery({
    queryKey: spendKey(projectId),
    queryFn: () => getSpendOverview({ data: { projectId } }),
  });
  return (
    <Link
      to="/p/$projectId/settings/limits"
      params={{ projectId }}
      className="text-xs text-muted-foreground underline-offset-2 hover:underline"
    >
      {data?.spend
        ? `${formatUsd(data.spend.monthUsd)} spent this month · Usage & limits`
        : "Usage & limits"}
    </Link>
  );
}

const ATTENTION: { status: StatusFilter; label: string }[] = [
  { status: "proposed", label: "awaiting approval" },
  { status: "approved", label: "approved, not run" },
  { status: "failed", label: "failed" },
];

// Leads the page with what needs a decision. Counts come from the loaded list,
// so they only show on the unfiltered view.
function NeedsAttention({
  entries,
  onPick,
}: {
  entries: LedgerEntryWithNames[];
  onPick: (status: StatusFilter) => void;
}) {
  const items = ATTENTION.map((item) => ({
    ...item,
    count: entries.filter((entry) => entry.status === item.status).length,
  })).filter((item) => item.count > 0);
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium">Needs attention</span>
      {items.map((item) => (
        <Button
          key={item.status}
          variant="outline"
          size="sm"
          onClick={() => onPick(item.status)}
        >
          {item.count} {item.label}
        </Button>
      ))}
    </div>
  );
}

export function ChangeLedgerPage({
  projectId,
  initialChange,
}: {
  projectId: string;
  initialChange?: string;
}) {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [openId, setOpenId] = useState<string | null>(initialChange ?? null);
  const query = useQuery({
    queryKey: [...ledgerListKey(projectId), status],
    queryFn: () =>
      getLedgerEntries({
        data: {
          projectId,
          status: status === "all" ? undefined : status,
          limit: 200,
        },
      }),
  });

  return (
    <div className="space-y-8 p-4 md:p-6">
      <PageHeader
        title="Workflows & changes"
        description="Every change we propose, approve and publish, with the evidence behind it and the before and after observations recorded for it. Observations are readings, not proof of cause."
        actions={<SpendIndicator projectId={projectId} />}
      />
      <section className="space-y-3">
        <SectionHeader
          title="Changes"
          hint="Newest first. Open a change to see its evidence, observations and costs."
        />
        <QueryState
          query={query}
          errorFallback="Could not load the change ledger."
          loading={<SkeletonCard />}
        >
          {(entries) => (
            <>
              {status === "all" ? (
                <NeedsAttention entries={entries} onPick={setStatus} />
              ) : null}
              <LedgerList
                entries={entries}
                status={status}
                onStatusChange={setStatus}
                onOpen={setOpenId}
              />
            </>
          )}
        </QueryState>
      </section>
      <LedgerDetailSheet
        projectId={projectId}
        entryId={openId}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}
