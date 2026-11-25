import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/client/components/ui/badge";
import { SortableHeader } from "@/client/components/table/SortableHeader";
import { ExternalUrlCell } from "@/client/components/table/url";
import { formatRelativeTime } from "@/client/lib/relative-time";
import { SOURCE_CLASS_LABELS } from "@/server/features/source-intelligence/rules/sourceClass";
import {
  engineLabel,
  RELATION_LABELS,
  type QueryTableRow,
  type SourceTableRow,
} from "./sourceIntelligence";

export const sourceColumns: ColumnDef<SourceTableRow>[] = [
  {
    id: "name",
    header: ({ column }) => <SortableHeader column={column} label="Source" />,
    cell: ({ row }) => (
      <div className="min-w-56 space-y-0.5">
        <p className="font-medium break-words">
          {row.original.title ?? row.original.domain}
        </p>
        <ExternalUrlCell value={row.original.key} label={row.original.key} />
      </div>
    ),
  },
  {
    id: "cited",
    header: ({ column }) => (
      <SortableHeader column={column} label="Cited in" align="right" />
    ),
    cell: ({ row }) => row.original.citedAnswers,
    meta: {
      headerClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
  },
  {
    id: "retrieved",
    header: ({ column }) => (
      <SortableHeader column={column} label="Retrieved in" align="right" />
    ),
    cell: ({ row }) => row.original.retrievedAnswers,
    meta: {
      headerClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
  },
  {
    id: "relation",
    header: "Relation",
    cell: ({ row }) => (
      <span className="text-xs">{RELATION_LABELS[row.original.relation]}</span>
    ),
  },
  {
    id: "sourceClass",
    header: "Type",
    cell: ({ row }) => (
      <span className="text-xs">
        {SOURCE_CLASS_LABELS[row.original.sourceClass]}
      </span>
    ),
  },
  {
    id: "brand",
    header: "Brand",
    cell: ({ row }) =>
      row.original.brand === "competitor" ? (
        <Badge variant="soft">Competitor</Badge>
      ) : row.original.brand === "own" ? (
        <Badge variant="soft">You</Badge>
      ) : null,
  },
  {
    id: "engines",
    header: "Engines",
    cell: ({ row }) => (
      <span className="text-xs">
        {row.original.engines.map(engineLabel).join(", ")}
      </span>
    ),
  },
  {
    id: "lastSeen",
    header: ({ column }) => (
      <SortableHeader column={column} label="Last seen" />
    ),
    cell: ({ row }) =>
      row.original.lastSeen ? formatRelativeTime(row.original.lastSeen) : "",
  },
];

const metricNumber = new Intl.NumberFormat("en-US");

const keywordMetricColumns: ColumnDef<QueryTableRow>[] = [
  {
    id: "searchVolume",
    header: "Google searches / month",
    cell: ({ row }) =>
      row.original.searchVolume === null
        ? row.original.metricsFetchedAt
          ? "Unavailable"
          : "—"
        : metricNumber.format(row.original.searchVolume),
    meta: {
      headerClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
  },
  {
    id: "keywordDifficulty",
    header: "Keyword difficulty",
    cell: ({ row }) =>
      row.original.keywordDifficulty === null
        ? "—"
        : `${row.original.keywordDifficulty}/100`,
    meta: {
      headerClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
  },
];

export const queryColumns: ColumnDef<QueryTableRow>[] = [
  {
    id: "name",
    header: ({ column }) => (
      <SortableHeader column={column} label="Search reported" />
    ),
    cell: ({ row }) => (
      <span className="font-medium break-words">{row.original.query}</span>
    ),
    meta: { cellClassName: "min-w-56" },
  },
  {
    id: "answers",
    header: ({ column }) => (
      <SortableHeader column={column} label="Answers" align="right" />
    ),
    cell: ({ row }) => row.original.answers,
    meta: {
      headerClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
  },
  {
    id: "prompts",
    header: "Prompts",
    cell: ({ row }) => row.original.prompts,
    meta: {
      headerClassName: "text-right",
      cellClassName: "text-right tabular-nums",
    },
  },
  {
    id: "engines",
    header: "Engines",
    cell: ({ row }) => (
      <span className="text-xs">
        {row.original.engines.map(engineLabel).join(", ")}
      </span>
    ),
  },
  {
    id: "lastSeen",
    header: ({ column }) => (
      <SortableHeader column={column} label="Last seen" />
    ),
    cell: ({ row }) =>
      row.original.lastSeen ? formatRelativeTime(row.original.lastSeen) : "",
  },
];

export const enrichedQueryColumns = [...queryColumns, ...keywordMetricColumns];
