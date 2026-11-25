import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Lightbulb, Save } from "lucide-react";
import { toast } from "sonner";
import {
  TableBulkActionBar,
  TableBulkActionButton,
} from "@/client/components/table/TableBulkActionBar";
import { useSaveKeywordsMutation } from "@/client/features/domain/mutations";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  createOpportunityFromGap,
  decideKeywordGapRows,
} from "@/serverFunctions/site-explorer";
import { gapKeys, type GapRow } from "./gap";

/** Actions on the ticked rows. Each one writes stored data; none calls a provider. */
export function GapBulkBar({
  projectId,
  runId,
  locationCode,
  rows,
  onClear,
}: {
  projectId: string;
  runId: string;
  locationCode: number | undefined;
  rows: GapRow[];
  onClear: () => void;
}) {
  const queryClient = useQueryClient();
  const selectedIds = rows.map((row) => row.id);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: gapKeys.table(projectId) });
  const saveKeywords = useSaveKeywordsMutation({ projectId, queryClient });
  const decide = useMutation({
    mutationFn: (input: {
      rowIds: string[];
      status: "active" | "watching" | "dismissed";
    }) =>
      decideKeywordGapRows({
        data: {
          projectId,
          runId,
          rowIds: input.rowIds,
          patch: { status: input.status },
        },
      }),
    onSuccess: (result) => {
      if (!result.ok) return void toast.error(result.reason);
      toast.success(`${result.data} keywords updated`);
      onClear();
      void refresh();
    },
    onError: (error) => toast.error(getStandardErrorMessage(error, "Failed")),
  });
  const bulkOpportunities = useMutation({
    mutationFn: async (rowIds: string[]) => {
      let created = 0;
      const refused: string[] = [];
      for (const rowId of rowIds) {
        const result = await createOpportunityFromGap({
          data: { projectId, runId, rowId },
        });
        if (result.ok) created++;
        else refused.push(result.reason);
      }
      return { created, refused };
    },
    onSuccess: ({ created, refused }) => {
      toast.success(
        `${created} opportunit${created === 1 ? "y" : "ies"} saved${
          refused.length > 0 ? `; ${refused.length} skipped. ${refused[0]}` : ""
        }`,
      );
      onClear();
      void refresh();
    },
    onError: (error) => toast.error(getStandardErrorMessage(error, "Failed")),
  });

  return (
    <TableBulkActionBar
      selectedCount={rows.length}
      selectedLabel="keywords"
      onClear={onClear}
      actions={
        <div className="flex items-center gap-1 p-1.5">
          <TableBulkActionButton
            icon={<Save />}
            disabled={saveKeywords.isPending}
            onClick={() =>
              saveKeywords.mutate(
                {
                  projectId,
                  keywords: rows.map((row) => row.keyword),
                  locationCode,
                  metrics: rows.map((row) => ({
                    keyword: row.keyword,
                    searchVolume: row.searchVolume,
                    cpc: row.cpc,
                    keywordDifficulty: row.keywordDifficulty,
                  })),
                },
                {
                  onSuccess: () => {
                    toast.success("Saved to Saved keywords");
                    onClear();
                  },
                  onError: (error) =>
                    toast.error(getStandardErrorMessage(error, "Failed")),
                },
              )
            }
          >
            Save keywords
          </TableBulkActionButton>
          <TableBulkActionButton
            icon={<Lightbulb />}
            disabled={bulkOpportunities.isPending}
            onClick={() => bulkOpportunities.mutate(selectedIds)}
          >
            Create opportunities
          </TableBulkActionButton>
          <TableBulkActionButton
            icon={<Eye />}
            onClick={() =>
              decide.mutate({ rowIds: selectedIds, status: "watching" })
            }
          >
            Watch
          </TableBulkActionButton>
          <TableBulkActionButton
            icon={<EyeOff />}
            onClick={() =>
              decide.mutate({ rowIds: selectedIds, status: "dismissed" })
            }
          >
            Dismiss
          </TableBulkActionButton>
        </div>
      }
    />
  );
}
