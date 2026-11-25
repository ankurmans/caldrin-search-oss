import type { ReactNode } from "react";
import { SafeExternalLink } from "@/client/components/SafeExternalLink";
import { SectionHeader } from "@/client/components/PageHeader";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import type {
  LedgerCostRow,
  LedgerEntry,
  LedgerEntryWithNames,
  LedgerEvidence,
} from "@/server/features/ledger/types";
import { formatDay, formatTime, formatUsd, humanize } from "./helpers";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}

function who(name: string | null, at: string | null): string {
  if (!name && !at) return "-";
  return `${name ?? "Unknown user"}${at ? `, ${formatTime(at)}` : ""}`;
}

export function OverviewSection({ entry }: { entry: LedgerEntryWithNames }) {
  return (
    <section className="space-y-3">
      <SectionHeader title="Approval and publication" />
      {entry.error ? (
        <Alert variant="destructive">
          <AlertDescription>{entry.error}</AlertDescription>
        </Alert>
      ) : null}
      <dl className="grid gap-3 sm:grid-cols-2">
        <Fact label="Proposed by">
          {who(entry.proposedByName, entry.createdAt)}
        </Fact>
        <Fact label="Approved by">
          {entry.approvedAt || entry.approvedByUserId
            ? who(entry.approvedByName, entry.approvedAt)
            : "Not approved"}
        </Fact>
        <Fact label="Approved revision">
          {entry.approvedRevision ?? "-"}
          {entry.contentRevision !== null
            ? ` (proposed on revision ${entry.contentRevision})`
            : ""}
        </Fact>
        <Fact label="Publication status">
          {entry.status === "rolled_back"
            ? `${humanize(entry.publicationStatus)}, then rolled back`
            : humanize(entry.publicationStatus)}
        </Fact>
        <Fact label="Executed">
          {entry.executedAt
            ? who(entry.executedByName, entry.executedAt)
            : "Not executed"}
        </Fact>
        <Fact label="External id">{entry.externalId ?? "-"}</Fact>
        <Fact label="Target URL">
          {entry.targetUrl ? (
            <SafeExternalLink
              url={entry.targetUrl}
              label={entry.targetUrl}
              className="inline-flex items-center gap-1 text-brand-text underline-offset-4 hover:underline"
            />
          ) : (
            "-"
          )}
        </Fact>
        <Fact label="Rollback">
          {entry.rolledBackAt
            ? `Rolled back ${who(entry.rolledBackByName, entry.rolledBackAt)}`
            : entry.rollbackKind === "none"
              ? "No rollback recorded"
              : `Available: ${humanize(entry.rollbackKind)}`}
        </Fact>
        <Fact label="Measurement plan">
          {entry.measurementMetric
            ? `${entry.measurementMetric}, read ${entry.measurementWindowDays ?? "?"} days after execution`
            : "None set"}
          {entry.baselineStart && entry.baselineEnd
            ? `. Baseline window ${formatDay(entry.baselineStart)} to ${formatDay(entry.baselineEnd)}.`
            : ""}
        </Fact>
        {entry.status === "rejected" ? (
          <Fact label="Rejected by">
            {who(entry.finalDecidedByName, entry.finalDecidedAt)}
          </Fact>
        ) : null}
        <Fact label={entry.status === "rejected" ? "Reason" : "Final decision"}>
          {entry.finalDecision
            ? entry.status === "rejected"
              ? entry.finalDecision.replace(/^Rejected:\s*/, "")
              : `${entry.finalDecision} (${who(entry.finalDecidedByName, entry.finalDecidedAt)})`
            : "None recorded"}
        </Fact>
      </dl>
    </section>
  );
}

export function EvidenceSection({ evidence }: { evidence: LedgerEvidence[] }) {
  return (
    <section className="space-y-3">
      <SectionHeader
        title="Supporting evidence"
        hint="Copied when the change was proposed. Later edits to the opportunity do not rewrite it."
      />
      {evidence.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No evidence rows were recorded with this change.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Observed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {evidence.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.source}</TableCell>
                <TableCell className="whitespace-normal">
                  {row.url ? (
                    <SafeExternalLink
                      url={row.url}
                      label={row.label}
                      className="inline-flex items-center gap-1 text-brand-text underline-offset-4 hover:underline"
                    />
                  ) : (
                    row.label
                  )}
                </TableCell>
                <TableCell className="whitespace-normal">{row.value}</TableCell>
                <TableCell>{formatTime(row.observedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function StateBlock({ title, text }: { title: string; text: string | null }) {
  return (
    <div className="min-w-0 space-y-1">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {text ? (
        <pre
          tabIndex={0}
          className="max-h-64 overflow-auto rounded-lg border bg-muted/40 p-2 text-xs whitespace-pre-wrap break-words"
        >
          {text}
        </pre>
      ) : (
        <p className="text-xs text-muted-foreground">Not recorded.</p>
      )}
    </div>
  );
}

export function StatesSection({ entry }: { entry: LedgerEntry }) {
  return (
    <section className="space-y-3">
      <SectionHeader
        title="Before and after"
        hint="Before is the text when proposed. After is what was proposed. Applied diff is what was actually written."
      />
      <div className="grid gap-3 md:grid-cols-2">
        <StateBlock title="Before state" text={entry.beforeState} />
        <StateBlock title="Proposed after state" text={entry.afterState} />
      </div>
      <StateBlock title="Applied diff" text={entry.diff} />
    </section>
  );
}

export function CostsSection({
  costs,
}: {
  costs: { totalUsd: number; rows: LedgerCostRow[] };
}) {
  return (
    <section className="space-y-3">
      <SectionHeader
        title="Costs"
        hint={`Provider cost recorded against this change: ${formatUsd(costs.totalUsd)} in total.`}
      />
      {costs.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No provider cost has been recorded for this change.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead>Operation</TableHead>
              <TableHead className="text-right">Estimated</TableHead>
              <TableHead className="text-right">Actual</TableHead>
              <TableHead>When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {costs.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.provider}</TableCell>
                <TableCell>{row.operation}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatUsd(row.estimatedUsd)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatUsd(row.costUsd)}
                </TableCell>
                <TableCell>{formatTime(row.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
