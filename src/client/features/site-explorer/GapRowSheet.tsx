import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/client/components/ui/sheet";
import { ExternalUrlCell } from "@/client/components/table/url";
import { formatNumber } from "@/client/features/keywords/utils";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  createBriefFromGap,
  createOpportunityFromGap,
  decideKeywordGapRows,
} from "@/serverFunctions/site-explorer";
import { gapKeys, intentLabel, type GapRow } from "./gap";

const COMMERCIAL_PAGE_TYPES = new Set([
  "product",
  "collection",
  "service",
  "pricing",
  "homepage",
]);

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

export function GapRowSheet({
  projectId,
  runId,
  row,
  onClose,
}: {
  projectId: string;
  runId: string;
  row: GapRow | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<string | null>(null);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: gapKeys.table(projectId) });
  const fail = (error: unknown) =>
    toast.error(getStandardErrorMessage(error, "That did not work"));

  const decide = useMutation({
    mutationFn: (patch: {
      status?: "active" | "watching" | "dismissed";
      targetPageUrl?: string | null;
    }) =>
      decideKeywordGapRows({
        data: { projectId, runId, rowIds: row ? [row.id] : [], patch },
      }),
    onSuccess: (result) => {
      if (!result.ok) toast.error(result.reason);
      else void refresh();
    },
    onError: fail,
  });
  const opportunity = useMutation({
    mutationFn: (brief: boolean) => {
      const data = { projectId, runId, rowId: row?.id ?? "" };
      return brief
        ? createBriefFromGap({ data })
        : createOpportunityFromGap({ data });
    },
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(result.reason);
        return;
      }
      toast.success("Saved to Opportunities");
      void refresh();
      void queryClient.invalidateQueries({ queryKey: ["opportunities"] });
    },
    onError: fail,
  });

  const targetValue = target ?? row?.targetPageUrl ?? "";
  const commercial =
    row?.likelyPageType != null &&
    COMMERCIAL_PAGE_TYPES.has(row.likelyPageType);

  return (
    <Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {row ? (
          <>
            <SheetHeader>
              <SheetTitle className="break-words">{row.keyword}</SheetTitle>
              <SheetDescription>
                {row.kind === "missing"
                  ? "You do not rank for this keyword in the provider's data."
                  : "A competitor ranks ahead of you for this keyword."}{" "}
                Third-party estimate seen{" "}
                {new Date(row.observedAt).toLocaleDateString()}.
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-4 pb-6">
              <dl className="grid grid-cols-3 gap-3">
                <Fact label="Volume" value={formatNumber(row.searchVolume)} />
                <Fact
                  label="Difficulty"
                  value={formatNumber(row.keywordDifficulty)}
                />
                <Fact
                  label="Your position"
                  value={row.targetPosition ? `#${row.targetPosition}` : "None"}
                />
                <Fact label="Intent" value={intentLabel(row.intent)} />
                <Fact label="Competitors" value={String(row.competitorCount)} />
                <Fact label="Winning page" value={row.likelyPageType ?? "-"} />
              </dl>

              <section aria-label="Who ranks">
                <h3 className="mb-2 text-sm font-semibold">
                  Competitor rankings
                </h3>
                <ul className="space-y-2">
                  {row.positions.map((position) => (
                    <li
                      key={position.competitorDomain}
                      className="rounded-lg border p-2 text-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">
                          {position.competitorDomain}
                        </span>
                        <Badge variant="outline">#{position.position}</Badge>
                      </div>
                      <ExternalUrlCell
                        value={position.url}
                        label={position.url ?? ""}
                      />
                    </li>
                  ))}
                </ul>
              </section>

              {commercial ? (
                <p className="rounded-lg border bg-muted/40 p-2 text-sm">
                  The winning page looks like a {row.likelyPageType} page, so
                  Caldrin will not recommend a blog post for this keyword.
                </p>
              ) : null}

              <section aria-label="Your page" className="space-y-2">
                <h3 className="text-sm font-semibold">Your target page</h3>
                <div className="flex gap-2">
                  <Input
                    value={targetValue}
                    placeholder="https://yoursite.com/page"
                    aria-label="Target page URL"
                    onChange={(event) => setTarget(event.target.value)}
                  />
                  <Button
                    variant="outline"
                    disabled={decide.isPending}
                    onClick={() =>
                      decide.mutate({
                        targetPageUrl: targetValue.trim() || null,
                      })
                    }
                  >
                    Save
                  </Button>
                </div>
              </section>

              <div className="flex flex-wrap gap-2">
                {row.opportunityId ? (
                  <Button
                    variant="outline"
                    nativeButton={false}
                    render={
                      <Link
                        to="/p/$projectId/opportunities"
                        params={{ projectId }}
                        search={{ opportunity: row.opportunityId }}
                      />
                    }
                  >
                    Open opportunity
                  </Button>
                ) : (
                  <Button
                    disabled={opportunity.isPending}
                    onClick={() => opportunity.mutate(false)}
                  >
                    Create opportunity
                  </Button>
                )}
                <Button
                  variant="outline"
                  disabled={opportunity.isPending}
                  onClick={() => opportunity.mutate(true)}
                >
                  Create brief
                </Button>
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={
                    <Link
                      to="/p/$projectId/keywords"
                      params={{ projectId }}
                      search={{ q: row.keyword }}
                    />
                  }
                >
                  Inspect SERP
                </Button>
              </div>

              <div className="flex flex-wrap gap-2 border-t pt-4">
                {row.status === "active" ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => decide.mutate({ status: "watching" })}
                    >
                      Watch
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => decide.mutate({ status: "dismissed" })}
                    >
                      Dismiss
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => decide.mutate({ status: "active" })}
                  >
                    Move back to open
                  </Button>
                )}
              </div>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
