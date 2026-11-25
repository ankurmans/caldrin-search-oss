import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { formatRelativeTime } from "@/client/lib/relative-time";
import { INCLUDED_NOTE, plainReason } from "@/client/features/spend/costText";
import { useCostDisplay } from "@/client/features/spend/useCostDisplay";
import {
  analyseSourcePageAction,
  getSourceAnalysis,
} from "@/serverFunctions/source-intelligence";
import { APPROACH_LABELS } from "@/types/schemas/source-intelligence";
import { analysisKey } from "./sourceIntelligence";

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">None found</p>
      ) : (
        <ul className="list-disc space-y-0.5 pl-5 text-sm">
          {items.map((item) => (
            <li key={item} className="break-words">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * What an external source page says, read on request. Opening the sheet only
 * shows a saved reading; reading a page is priced first and needs a second
 * click.
 */
export function PageReading({
  projectId,
  url,
}: {
  projectId: string;
  url: string;
}) {
  const queryClient = useQueryClient();
  const { showCosts, cost } = useCostDisplay();
  const [price, setPrice] = useState<{ usd: number; basis: string } | null>(
    null,
  );
  const saved = useQuery({
    queryKey: analysisKey(projectId, url),
    queryFn: () => getSourceAnalysis({ data: { projectId, url } }),
  });
  const run = useMutation({
    mutationFn: (input: { confirm: boolean; refresh: boolean }) =>
      analyseSourcePageAction({ data: { projectId, url, ...input } }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(plainReason(result.reason, showCosts));
        return;
      }
      if (result.data.status === "preview") {
        setPrice({
          usd: result.data.estimatedUsd,
          basis: result.data.basis,
        });
        return;
      }
      setPrice(null);
      void queryClient.invalidateQueries({
        queryKey: analysisKey(projectId, url),
      });
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "The page was not read")),
  });

  const analysis = saved.data;
  const items = (kind: string) =>
    analysis?.items.filter((i) => i.kind === kind).map((i) => i.text) ?? [];

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">What this page says</h3>
      {analysis ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="soft">{APPROACH_LABELS[analysis.approach]}</Badge>
            <span className="text-xs text-muted-foreground">
              Read {formatRelativeTime(analysis.analysedAt)}
            </span>
          </div>
          <p className="text-sm break-words">{analysis.summary}</p>
          <p className="text-sm">
            {analysis.namesBrand
              ? "The page names your brand."
              : "The page does not name your brand."}
          </p>
          <List
            title="Tracked competitors named"
            items={items("competitor_named")}
          />
          <List
            title="Buyer questions it answers"
            items={items("buyer_question")}
          />
          <List title="Dated facts to check" items={items("dated_fact")} />
          <p className="text-xs text-muted-foreground">
            A reading by an AI model of the page as it was fetched. Being named
            on a page does not guarantee a future AI citation.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Not read yet. Reading fetches this page and runs one short AI summary.
        </p>
      )}
      {price ? (
        <div className="space-y-2 rounded-md border p-3 text-sm">
          <p>
            {cost(price.usd)
              ? `This costs up to ${cost(price.usd)}. ${price.basis}`
              : INCLUDED_NOTE}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={run.isPending}
              onClick={() => run.mutate({ confirm: true, refresh: true })}
            >
              {run.isPending ? <Spinner /> : null}
              Read the page
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPrice(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={run.isPending || saved.isLoading}
          onClick={() =>
            run.mutate({
              confirm: false,
              refresh: analysis !== null && analysis !== undefined,
            })
          }
        >
          {analysis ? "Read it again" : "Read this page"}
        </Button>
      )}
    </section>
  );
}
