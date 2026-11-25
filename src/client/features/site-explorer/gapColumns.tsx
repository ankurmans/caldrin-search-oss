import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/client/components/ui/badge";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import {
  makeSelectionColumn,
  type useSelectionAnchor,
} from "@/client/components/table/DataTable";
import { formatNumber } from "@/client/features/keywords/utils";
import { formatRelativeTime } from "@/client/lib/relative-time";
import { intentLabel, STATUS_LABELS, type GapRow } from "./gap";

export const COLUMN_LABELS: Record<string, string> = {
  searchVolume: "Volume",
  keywordDifficulty: "Difficulty",
  intent: "Intent",
  kind: "Type",
  bestPosition: "Best competitor",
  targetPosition: "Your position",
  competitorCount: "Competitors",
  likelyPageType: "Winning page",
  observedAt: "Observed",
  status: "Status",
};

export function buildGapColumns(
  anchor: ReturnType<typeof useSelectionAnchor>,
): ColumnDef<GapRow>[] {
  return [
    makeSelectionColumn<GapRow>(
      anchor,
      (row) => `Select ${row.original.keyword}`,
    ),
    {
      id: "keyword",
      accessorKey: "keyword",
      header: ({ column }) => (
        <SortableHeader column={column} label="Keyword" />
      ),
      cell: ({ row }) => (
        <span className="font-medium break-words">{row.original.keyword}</span>
      ),
      meta: { cellClassName: "min-w-48" },
    },
    {
      id: "searchVolume",
      accessorKey: "searchVolume",
      header: ({ column }) => (
        <SortableHeader column={column} label="Volume" align="right" />
      ),
      cell: ({ row }) => formatNumber(row.original.searchVolume),
      meta: {
        headerClassName: "text-right",
        cellClassName: "text-right tabular-nums",
      },
    },
    {
      id: "keywordDifficulty",
      accessorKey: "keywordDifficulty",
      header: ({ column }) => (
        <SortableHeader column={column} label="Difficulty" align="right" />
      ),
      cell: ({ row }) => formatNumber(row.original.keywordDifficulty),
      meta: {
        headerClassName: "text-right",
        cellClassName: "text-right tabular-nums",
      },
    },
    {
      id: "intent",
      header: "Intent",
      enableSorting: false,
      cell: ({ row }) => intentLabel(row.original.intent),
    },
    {
      id: "kind",
      header: "Type",
      enableSorting: false,
      cell: ({ row }) => (
        <Badge variant={row.original.kind === "missing" ? "warning" : "info"}>
          {row.original.kind === "missing" ? "Missing" : "Outranked"}
        </Badge>
      ),
    },
    {
      id: "bestPosition",
      accessorKey: "bestPosition",
      header: ({ column }) => (
        <SortableHeader column={column} label="Best competitor" />
      ),
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          {row.original.bestDomain}{" "}
          <span className="text-muted-foreground">
            #{row.original.bestPosition}
          </span>
        </span>
      ),
    },
    {
      id: "targetPosition",
      accessorKey: "targetPosition",
      header: ({ column }) => (
        <SortableHeader column={column} label="Your position" align="right" />
      ),
      cell: ({ row }) =>
        row.original.targetPosition ? `#${row.original.targetPosition}` : "-",
      meta: {
        headerClassName: "text-right",
        cellClassName: "text-right tabular-nums",
      },
    },
    {
      id: "competitorCount",
      accessorKey: "competitorCount",
      header: ({ column }) => (
        <SortableHeader column={column} label="Competitors" align="right" />
      ),
      cell: ({ row }) => row.original.competitorCount,
      meta: {
        headerClassName: "text-right",
        cellClassName: "text-right tabular-nums",
      },
    },
    {
      id: "likelyPageType",
      header: "Winning page",
      enableSorting: false,
      cell: ({ row }) => row.original.likelyPageType ?? "-",
    },
    {
      id: "observedAt",
      accessorKey: "observedAt",
      header: ({ column }) => (
        <SortableHeader column={column} label="Observed" />
      ),
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatRelativeTime(row.original.observedAt)}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      enableSorting: false,
      cell: ({ row }) =>
        row.original.opportunityId ? (
          <Badge variant="success">Opportunity</Badge>
        ) : row.original.status === "active" ? (
          <span className="text-muted-foreground">Open</span>
        ) : (
          <Badge variant="outline">
            {
              STATUS_LABELS[
                row.original.status === "watching" ? "watching" : "dismissed"
              ]
            }
          </Badge>
        ),
    },
  ];
}
