import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { createAttributionOpportunityFn } from "@/serverFunctions/attributionSearch";
import type { getAttributionFindingsFn } from "@/serverFunctions/attributionSearch";
import type { ReportParams } from "./attributionQueries";

type Findings = Awaited<ReturnType<typeof getAttributionFindingsFn>>;

const PRIORITY = { high: "warning", medium: "info", low: "outline" } as const;

/** Pages worth a look, each with the numbers that raised it. Storing one changes nothing on the site. */
export function FindingsPanel({
  findings,
  params,
}: {
  findings: Findings;
  params: ReportParams;
}) {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (key: string) =>
      createAttributionOpportunityFn({ data: { ...params, key } }),
    onSuccess: async (result) => {
      if (result.ok) {
        toast.success(
          "Saved as a Search Opportunity. Nothing was changed on your site.",
        );
        await queryClient.invalidateQueries({ queryKey: ["opportunities"] });
      } else toast.error(result.reason);
    },
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(error, "Could not save the opportunity"),
      ),
  });
  if (findings.findings.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">Worth a look</h2>
      <ul className="space-y-2">
        {findings.findings.map((f) => (
          <li
            key={f.key}
            className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card p-4"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={PRIORITY[f.priority]}>{f.priority}</Badge>
                <span className="text-sm font-medium">{f.title}</span>
              </div>
              <p className="break-all text-xs text-muted-foreground">
                {f.host}
                {f.path}
              </p>
              <p className="text-sm">{f.reason}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={create.isPending || params.demo}
              title={
                params.demo
                  ? "Demo data cannot be saved as an opportunity"
                  : undefined
              }
              onClick={() => create.mutate(f.key)}
            >
              Save as opportunity
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
