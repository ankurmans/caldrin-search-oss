import { FanOutKeywordLookup } from "./FanOutKeywordLookup";
import type { QueryTableRow } from "./sourceIntelligence";
import { useMutation } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { exportRows } from "@/client/lib/exportRows";
import { getFanOutQueryExport } from "@/serverFunctions/source-intelligence";
import {
  engineLabel,
  type SourceQuery,
} from "@/types/schemas/source-intelligence";

export function FanOutExport({
  marketSelected,
  rows,
  disabled,
  ...input
}: Pick<SourceQuery, "projectId" | "filters" | "sortBy" | "sortDir"> & {
  marketSelected: boolean;
  rows: QueryTableRow[];
  disabled: boolean;
}) {
  const { filters } = input;
  const csv = useMutation({
    mutationFn: async () => {
      const exportData = await getFanOutQueryExport({
        data: input,
      });
      await exportRows({
        format: "csv",
        feature: "query_fan_out",
        filename: "query-fan-out",
        headers: [
          "Reported search",
          "Engines",
          "Answers",
          "Prompts",
          "Last seen",
          "Google searches per month",
          "Keyword difficulty",
          "Metrics fetched at",
          "Location code",
          "Language",
        ],
        rows: exportData.map((row) => [
          row.query,
          row.engines.map(engineLabel).join(", "),
          row.answers,
          row.prompts,
          row.lastSeen,
          row.searchVolume,
          row.keywordDifficulty,
          row.metricsFetchedAt,
          filters.locationCode,
          filters.languageCode,
        ]),
      });
    },
    onError: () =>
      toast.error("Could not export reported searches. Try again."),
  });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">
        {marketSelected
          ? "Keyword metrics use saved research for this market."
          : "Select a market to see saved keyword metrics."}
      </span>
      {marketSelected && (
        <FanOutKeywordLookup
          projectId={input.projectId}
          filters={filters}
          rows={rows}
          disabled={disabled}
        />
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || csv.isPending}
        onClick={() => csv.mutate()}
      >
        <Download aria-hidden="true" />
        {csv.isPending ? "Exporting…" : "Export CSV"}
      </Button>
    </div>
  );
}
