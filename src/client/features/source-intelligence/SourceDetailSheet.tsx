import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/client/components/ui/sheet";
import { ExternalUrlCell } from "@/client/components/table/url";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { formatRelativeTime } from "@/client/lib/relative-time";
import {
  createSourceOpportunityAction,
  getSourceDetail,
  setSourceDecision,
} from "@/serverFunctions/source-intelligence";
import type { SourceFilters } from "@/types/schemas/source-intelligence";
import { PageReading } from "./PageReading";
import {
  engineLabel,
  RELATION_LABELS,
  sourceKeys,
  type SourceTableRow,
} from "./sourceIntelligence";

export function SourceDetailSheet({
  projectId,
  filters,
  row,
  onClose,
}: {
  projectId: string;
  filters: SourceFilters;
  row: SourceTableRow | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const url = row?.key ?? "";
  const detail = useQuery({
    queryKey: sourceKeys.detail(projectId, url, filters),
    queryFn: () => getSourceDetail({ data: { projectId, filters, url } }),
    enabled: row !== null,
  });
  const fail = (error: unknown) =>
    toast.error(getStandardErrorMessage(error, "That did not work"));

  const create = useMutation({
    mutationFn: (action: "content" | "third_party" | "link_prospect") =>
      createSourceOpportunityAction({
        data: { projectId, filters, url, action },
      }),
    onSuccess: (result) => {
      if (!result.ok) return void toast.error(result.reason);
      toast.success("Opportunity saved");
    },
    onError: fail,
  });
  const decide = useMutation({
    mutationFn: (decision: "monitor" | "dismiss" | "clear") =>
      setSourceDecision({
        data: { projectId, domain: row?.domain ?? "", decision },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: sourceKeys.all(projectId),
      });
      onClose();
    },
    onError: fail,
  });

  const own = row?.brand === "own";
  const appearances = detail.data?.appearances ?? [];

  return (
    <Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {row ? (
          <>
            <SheetHeader>
              <SheetTitle className="break-words">
                {row.title ?? row.domain}
              </SheetTitle>
              <SheetDescription className="space-y-1">
                <ExternalUrlCell value={row.key} label={row.key} />
                <span className="flex flex-wrap gap-2 pt-1">
                  <Badge variant="soft">{RELATION_LABELS[row.relation]}</Badge>
                  {row.brand === "competitor" ? (
                    <Badge variant="soft">Competitor</Badge>
                  ) : null}
                  {row.decision ? (
                    <Badge variant="soft">
                      {row.decision === "monitor" ? "Monitoring" : "Dismissed"}
                    </Badge>
                  ) : null}
                </span>
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-4 pb-6">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Cited in</dt>
                  <dd className="font-medium tabular-nums">
                    {row.citedAnswers} answers
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Retrieved in
                  </dt>
                  <dd className="font-medium tabular-nums">
                    {row.retrievedAnswers} answers
                  </dd>
                </div>
              </dl>
              {row.description ? (
                <p className="text-sm text-muted-foreground">
                  {row.description}
                </p>
              ) : null}

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Turn it into work</h3>
                {own ? (
                  <p className="text-sm text-muted-foreground">
                    This page is on your own site. Improve it from Citation
                    gaps.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={create.isPending}
                      onClick={() => create.mutate("content")}
                    >
                      Content opportunity
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={create.isPending}
                      onClick={() => create.mutate("third_party")}
                    >
                      Third-party coverage
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={create.isPending}
                      onClick={() => create.mutate("link_prospect")}
                    >
                      Link prospect
                    </Button>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Saved in Opportunities, where it can go to Content Studio.
                  Being named on a page does not guarantee a future AI citation.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={decide.isPending}
                    onClick={() =>
                      decide.mutate(
                        row.decision === "monitor" ? "clear" : "monitor",
                      )
                    }
                  >
                    {row.decision === "monitor"
                      ? "Stop monitoring domain"
                      : "Monitor domain"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={decide.isPending}
                    onClick={() =>
                      decide.mutate(
                        row.decision === "dismiss" ? "clear" : "dismiss",
                      )
                    }
                  >
                    {row.decision === "dismiss"
                      ? "Restore domain"
                      : "Dismiss domain"}
                  </Button>
                </div>
              </section>

              {own ? null : <PageReading projectId={projectId} url={url} />}

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">
                  Answers that used this page
                </h3>
                {detail.isLoading ? (
                  <Spinner className="size-4" aria-label="Loading" />
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {appearances.map((a) => (
                      <li key={a.observationId} className="space-y-1 p-3">
                        <Link
                          to="/p/$projectId/ai-visibility/prompts/$promptId"
                          params={{ projectId, promptId: a.promptId }}
                          className="text-sm font-medium underline-offset-2 hover:underline"
                        >
                          {a.prompt}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {engineLabel(a.engine)}
                          {a.collectedAt
                            ? `, ${formatRelativeTime(a.collectedAt)}`
                            : ""}
                          {a.cited ? ", cited" : ""}
                          {a.retrieved ? ", retrieved" : ""}
                        </p>
                        {a.queries.length > 0 ? (
                          <p className="text-xs">
                            Searches reported: {a.queries.join("; ")}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
