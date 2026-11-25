import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import {
  analyzeSourceGap,
  createSourceGapOpportunityFn,
  setSourceGapOwner,
} from "@/serverFunctions/source-gap";
import type { SourceGapAnalysis } from "@/shared/source-gap";
import { AiLoading, AiQueryError } from "../ai-visibility/shared";
import { SourceGapView } from "./SourceGapView";
import {
  shortUrl,
  sourceGapKey,
  sourceGapQueryOptions,
} from "./sourceGapShared";

const AUTO = "__auto";

function OwnerPicker({
  analysis,
  pending,
  onChange,
}: {
  analysis: SourceGapAnalysis;
  pending: boolean;
  onChange: (url: string | null) => void;
}) {
  const candidates = analysis.owner.candidates;
  const [typed, setTyped] = useState("");
  const items = [
    { value: AUTO, label: "Let Caldrin pick" },
    ...candidates.map((c) => ({ value: c.url, label: shortUrl(c.url) })),
  ];
  const value = analysis.owner.overridden
    ? (analysis.owner.selected?.url ?? AUTO)
    : AUTO;
  const typedUrl = typed.trim();
  return (
    <div className="flex flex-col gap-2 pt-1">
      {candidates.length > 0 || analysis.owner.overridden ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {analysis.owner.confidence === "low" || !analysis.owner.selected
              ? "Confirm or choose a better page:"
              : "Use a different page:"}
          </span>
          <Select
            items={items}
            value={value}
            disabled={pending}
            onValueChange={(v) => {
              if (typeof v === "string") onChange(v === AUTO ? null : v);
            }}
          >
            <SelectTrigger aria-label="Owner page" className="h-9 min-w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="w-max min-w-(--anchor-width) max-w-[min(28rem,var(--available-width))]">
              {items.map((i) => (
                <SelectItem key={i.value} value={i.value}>
                  {i.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!typedUrl) return;
          onChange(typedUrl);
          setTyped("");
        }}
      >
        <span className="text-xs text-muted-foreground">
          Or name the page yourself:
        </span>
        <Input
          type="url"
          name="owner-page-url"
          autoComplete="off"
          aria-label="Owner page address"
          placeholder="https://yoursite.com/the-page"
          value={typed}
          disabled={pending}
          onChange={(event) => setTyped(event.target.value)}
          className="h-9 w-72"
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={pending || !typedUrl}
        >
          Use this page
        </Button>
      </form>
    </div>
  );
}

/**
 * Why the pages answers cited beat yours, for one tracked prompt. Shows the
 * newest stored analysis and runs a new one on request; running reads stored
 * answers and fetches pages, and starts no AI query.
 */
export function SourceGapPanel({
  projectId,
  promptId,
}: {
  projectId: string;
  promptId: string;
}) {
  const queryClient = useQueryClient();
  const options = sourceGapQueryOptions(projectId, promptId);
  const latest = useQuery(options);
  const refreshAll = () =>
    void queryClient.invalidateQueries({ queryKey: sourceGapKey(projectId) });
  const analyze = useMutation({
    mutationFn: (request: { forceRefresh: boolean; retryUrl?: string }) =>
      analyzeSourceGap({ data: { projectId, promptId, ...request } }),
    onSuccess: (result) => {
      if (!result.ok) return void toast.error(result.reason);
      queryClient.setQueryData(options.queryKey, result.data);
      refreshAll();
    },
  });
  const owner = useMutation({
    mutationFn: (ownerUrl: string | null) =>
      setSourceGapOwner({ data: { projectId, promptId, ownerUrl } }),
    onSuccess: (result) => {
      if (!result.ok) return void toast.error(result.reason);
      analyze.mutate({ forceRefresh: false });
    },
  });
  const opportunity = useMutation({
    mutationFn: (analysisId: string) =>
      createSourceGapOpportunityFn({ data: { projectId, analysisId } }),
    onSuccess: (result, analysisId) => {
      if (!result.ok) return void toast.error(result.reason);
      toast.success("Added to Search Opportunities.");
      queryClient.setQueryData<SourceGapAnalysis | null>(
        options.queryKey,
        (old) =>
          old && old.id === analysisId
            ? { ...old, opportunityId: result.data.opportunityId }
            : old,
      );
      refreshAll();
    },
  });

  const analysis = analyze.data?.ok ? analyze.data.data : latest.data;
  if (latest.isPending) return <AiLoading />;
  if (latest.isError)
    return (
      <AiQueryError error={latest.error} retry={() => void latest.refetch()} />
    );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          pending={analyze.isPending}
          onClick={() => analyze.mutate({ forceRefresh: false })}
        >
          <Search />
          {analysis ? "Analyze again" : "Analyze cited pages"}
        </Button>
        {analysis ? (
          <Button
            size="sm"
            variant="outline"
            disabled={analyze.isPending}
            onClick={() => analyze.mutate({ forceRefresh: true })}
          >
            <RefreshCw />
            Re-read pages
          </Button>
        ) : null}
        <span className="text-xs text-muted-foreground">
          Reads stored answers and the pages they cited. No AI query is run.
        </span>
      </div>
      {analyze.isPending ? (
        <p className="text-sm text-muted-foreground">
          Reading cited pages and your site. This can take up to a minute.
        </p>
      ) : null}
      {analysis ? (
        <SourceGapView
          analysis={analysis}
          projectId={projectId}
          busy={owner.isPending || analyze.isPending}
          onRetry={(retryUrl) =>
            analyze.mutate({ forceRefresh: false, retryUrl })
          }
          onChoose={(url) => owner.mutate(url)}
          ownerPicker={
            <OwnerPicker
              analysis={analysis}
              pending={owner.isPending || analyze.isPending}
              onChange={(url) => owner.mutate(url)}
            />
          }
          opportunityButton={
            <Button
              size="sm"
              pending={opportunity.isPending}
              onClick={() => opportunity.mutate(analysis.id)}
            >
              Create Search Opportunity
            </Button>
          }
        />
      ) : analyze.isPending ? null : (
        <p className="text-sm text-muted-foreground">
          Not analyzed yet. Caldrin will compare the pages cited for this prompt
          with the closest page on your site.
        </p>
      )}
    </div>
  );
}
