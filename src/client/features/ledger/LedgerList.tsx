import { EmptyState } from "@/client/components/EmptyState";
import { Badge } from "@/client/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import type {
  LedgerEntry,
  LedgerEntryWithNames,
} from "@/server/features/ledger/types";
import { STATUS_LABELS, formatTime, humanize, statusVariant } from "./helpers";

export type StatusFilter = "all" | LedgerEntry["status"];

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
];

function isStatusFilter(value: string): value is StatusFilter {
  return STATUS_OPTIONS.some((option) => option.value === value);
}

export function LedgerList({
  entries,
  status,
  onStatusChange,
  onOpen,
}: {
  entries: LedgerEntryWithNames[];
  status: StatusFilter;
  onStatusChange: (status: StatusFilter) => void;
  onOpen: (entryId: string) => void;
}) {
  return (
    <div className="space-y-3">
      <Select
        items={STATUS_OPTIONS}
        value={status}
        onValueChange={(value) => {
          if (value != null && isStatusFilter(value)) onStatusChange(value);
        }}
      >
        <SelectTrigger size="sm" className="w-44" aria-label="Filter by status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {entries.length === 0 ? (
        <EmptyState
          kind={status === "all" ? "no-data" : "filtered"}
          title={
            status === "all"
              ? "No changes recorded yet"
              : "No changes with this status"
          }
          description={
            status === "all"
              ? "Changes appear here when a content draft is proposed for publishing."
              : "Pick another status to see other changes."
          }
        />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {entries.map((entry) => (
            <LedgerRow key={entry.id} entry={entry} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </div>
  );
}

function LedgerRow({
  entry,
  onOpen,
}: {
  entry: LedgerEntryWithNames;
  onOpen: (entryId: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        className="flex w-full flex-col gap-1.5 p-3 text-left hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
        onClick={() => onOpen(entry.id)}
      >
        <span className="flex flex-wrap items-center gap-2">
          <Badge variant={statusVariant(entry.status)}>
            {STATUS_LABELS[entry.status] ?? entry.status}
          </Badge>
          <Badge variant="outline">{humanize(entry.kind)}</Badge>
          <Badge variant="secondary">{humanize(entry.provider)}</Badge>
          <span className="ml-auto text-xs text-muted-foreground">
            {formatTime(entry.createdAt)}
          </span>
        </span>
        <span className="text-sm font-medium">{entry.proposedAction}</span>
        {entry.targetUrl ? (
          <span className="truncate text-xs text-muted-foreground">
            {entry.targetUrl}
          </span>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {entry.status === "rejected"
            ? `Rejected${entry.finalDecidedByName ? ` by ${entry.finalDecidedByName}` : ""}`
            : entry.approvedAt
              ? `Approved ${formatTime(entry.approvedAt)} by ${entry.approvedByName ?? "unknown"}`
              : "Not approved yet"}
        </span>
      </button>
    </li>
  );
}
