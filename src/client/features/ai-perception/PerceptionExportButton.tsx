import { useMutation } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import type { InsightsFilters } from "@/client/features/ai-visibility/insights/insightsShared";
import { exportRows } from "@/client/lib/exportRows";
import { getAiPerceptionExport } from "@/serverFunctions/ai-perception";
import { AI_ENGINE_LABELS } from "@/shared/ai-visibility";

export function PerceptionExportButton({
  projectId,
  filters,
  domain,
  brandName,
  disabled,
}: {
  projectId: string;
  filters: InsightsFilters;
  domain: string;
  brandName: string;
  disabled: boolean;
}) {
  const csv = useMutation({
    mutationFn: async () => {
      const data = await getAiPerceptionExport({
        data: { projectId, ...filters, domain },
      });
      await exportRows({
        feature: "brand_perception",
        format: "csv",
        filename: `brand-perception-${domain}`,
        headers: [
          "Brand",
          "Domain",
          "Prompt",
          "Engine",
          "Answer model",
          "Location code",
          "Language",
          "Collected at",
          "Reading status",
          "Stance",
          "Sentiment",
          "Evidence quote",
          "Corrected",
          "Answer ID",
          "Prompt set version",
          "Classifier version",
          "Window start",
          "Window end",
          "Partial export",
        ],
        rows: data.rows.map((row) => [
          row.brand,
          row.domain,
          row.prompt,
          AI_ENGINE_LABELS[row.engine],
          row.model,
          row.locationCode,
          row.languageCode,
          row.collectedAt,
          row.status,
          row.stance,
          row.sentiment,
          row.evidence,
          row.corrected,
          row.answerId,
          data.promptSetVersionId,
          data.classifierVersion,
          data.window.start,
          data.window.end,
          data.truncated,
        ]),
      });
      if (data.truncated && data.rows.length)
        toast.info(
          "This export contains the newest results. Shorten the date range to see the full set.",
        );
    },
    onError: () =>
      toast.error("Could not export perception evidence. Try again."),
  });
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={disabled || csv.isPending}
      aria-label={`Export answer evidence CSV for ${brandName}`}
      onClick={() => csv.mutate()}
    >
      <Download aria-hidden="true" />
      {csv.isPending ? "Exporting…" : "Export CSV"}
    </Button>
  );
}
