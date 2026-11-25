import type { ColumnDef } from "@tanstack/react-table";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import { Badge } from "@/client/components/ui/badge";
import { formatCompactDate } from "@/client/features/backlinks/backlinksPageUtils";
import { formatNumber } from "@/client/features/keywords/utils";
import {
  RECOMMENDATION_VARIANT,
  recommendationLabel,
  type LinkGapRow,
} from "./linkGap";

const NUMERIC = {
  headerClassName: "text-right",
  cellClassName: "text-right tabular-nums",
};

export function buildLinkGapColumns(): ColumnDef<LinkGapRow>[] {
  return [
    {
      id: "referringDomain",
      accessorKey: "referringDomain",
      header: ({ column }) => (
        <SortableHeader column={column} label="Referring domain" />
      ),
      cell: ({ row }) => (
        <span className="font-medium break-all">
          {row.original.referringDomain}
        </span>
      ),
      meta: { cellClassName: "min-w-44" },
    },
    {
      id: "competitorCount",
      accessorKey: "competitorCount",
      header: ({ column }) => (
        <SortableHeader column={column} label="Competitors" align="right" />
      ),
      cell: ({ row }) => (
        <span className="inline-flex items-center justify-end gap-1.5">
          {row.original.competitorCount >= 2 ? (
            <Badge variant="soft">
              Links to {row.original.competitorCount}
            </Badge>
          ) : (
            <span className="text-muted-foreground">1</span>
          )}
        </span>
      ),
      meta: NUMERIC,
    },
    {
      id: "score",
      accessorFn: (row) => row.qualification.score,
      header: ({ column }) => (
        <SortableHeader column={column} label="Score" align="right" />
      ),
      cell: ({ row }) => (
        <span className="inline-flex items-center justify-end gap-2">
          {Math.round(row.original.qualification.score)}
          <Badge
            variant={
              RECOMMENDATION_VARIANT[row.original.qualification.recommendation]
            }
          >
            {recommendationLabel(row.original.qualification.recommendation)}
          </Badge>
        </span>
      ),
      meta: NUMERIC,
    },
    {
      id: "domainRank",
      accessorKey: "domainRank",
      header: ({ column }) => (
        <SortableHeader column={column} label="Domain Rank" align="right" />
      ),
      cell: ({ row }) => formatNumber(row.original.domainRank),
      meta: NUMERIC,
    },
    {
      id: "spamScore",
      accessorKey: "spamScore",
      header: ({ column }) => (
        <SortableHeader column={column} label="Spam" align="right" />
      ),
      cell: ({ row }) => formatNumber(row.original.spamScore),
      meta: NUMERIC,
    },
    {
      id: "firstSeen",
      accessorKey: "firstSeen",
      header: ({ column }) => (
        <SortableHeader column={column} label="First seen" />
      ),
      cell: ({ row }) => formatCompactDate(row.original.firstSeen),
    },
    {
      id: "evidence",
      header: "Exact pages",
      enableSorting: false,
      cell: ({ row }) =>
        row.original.evidenceCount > 0 ? (
          <Badge variant="success">{row.original.evidenceCount} read</Badge>
        ) : (
          <span className="text-muted-foreground">Not read</span>
        ),
    },
  ];
}
