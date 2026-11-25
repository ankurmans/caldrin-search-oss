import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Globe, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { QueryError } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Spinner } from "@/client/components/ui/spinner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { formatRelativeTime } from "@/client/lib/relative-time";
import {
  addExplorerCompetitors,
  getSavedCompetitors,
  removeExplorerCompetitor,
} from "@/serverFunctions/site-explorer";
import { gapKeys } from "./gap";

import { DiscoveryPanel } from "./DiscoveryPanel";
import { MarketEditor } from "./MarketEditor";

export function CompetitorsPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const listQuery = useQuery({
    queryKey: gapKeys.competitors(projectId),
    queryFn: () => getSavedCompetitors({ data: { projectId } }),
  });
  const add = useMutation({
    mutationFn: () =>
      addExplorerCompetitors({
        data: {
          projectId,
          domains: text.split(/[\s,]+/).filter((part) => part.length > 0),
        },
      }),
    onSuccess: (result) => {
      if (!result.ok) return void toast.error(result.reason);
      setText("");
      void queryClient.invalidateQueries({
        queryKey: gapKeys.competitors(projectId),
      });
    },
    onError: (error) => toast.error(getStandardErrorMessage(error, "Failed")),
  });
  const remove = useMutation({
    mutationFn: (domain: string) =>
      removeExplorerCompetitor({ data: { projectId, domain } }),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: gapKeys.competitors(projectId),
      }),
    onError: (error) => toast.error(getStandardErrorMessage(error, "Failed")),
  });

  const saved = listQuery.data ?? [];

  return (
    <div className="px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Competitors</h1>
            <p className="text-sm text-muted-foreground">
              Saved for this project and reused by the keyword gap, backlinks
              and AI visibility. Adding one costs nothing.
            </p>
          </div>
          <Button
            variant="outline"
            nativeButton={false}
            render={
              <Link to="/p/$projectId/keyword-gap" params={{ projectId }} />
            }
          >
            Open keyword gap
          </Button>
        </header>

        <div className="grid items-start gap-4 lg:grid-cols-2">
          <section className="space-y-3 rounded-xl border bg-card p-4">
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (text.trim()) add.mutate();
              }}
            >
              <Input
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="competitor.com, another.com"
                aria-label="Competitor domains"
                className="max-w-sm flex-1"
              />
              <Button type="submit" disabled={!text.trim() || add.isPending}>
                Add
              </Button>
            </form>

            {listQuery.isError ? (
              <QueryError
                error={listQuery.error}
                fallback="Failed to load competitors"
                onRetry={() => void listQuery.refetch()}
                isRetrying={listQuery.isFetching}
              />
            ) : listQuery.isLoading ? (
              <Spinner className="size-4" aria-label="Loading" />
            ) : saved.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Globe className="size-4" /> No competitors saved yet.
              </p>
            ) : (
              <ul className="divide-y">
                {saved.map((competitor) => (
                  <li
                    key={competitor.id}
                    className="flex flex-wrap items-center gap-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 font-medium">
                        <span className="truncate">{competitor.domain}</span>
                        {competitor.source === "discovered" ? (
                          <Badge variant="soft">Discovered</Badge>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {competitor.lastAnalysedAt
                          ? `Last analyzed ${formatRelativeTime(competitor.lastAnalysedAt)}`
                          : "Not analyzed yet"}
                      </p>
                    </div>
                    <MarketEditor
                      projectId={projectId}
                      domain={competitor.domain}
                      markets={competitor.markets}
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${competitor.domain}`}
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(competitor.domain)}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <DiscoveryPanel
            projectId={projectId}
            saved={new Set(saved.map((competitor) => competitor.domain))}
          />
        </div>
      </div>
    </div>
  );
}
