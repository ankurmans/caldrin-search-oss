import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/client/components/ui/sheet";
import { createCitationGapOpportunity } from "@/serverFunctions/citation-gaps";
import {
  GAP_TYPE_LABELS,
  type CitationGapFinding,
} from "@/shared/citation-gaps";
import { FanOutLink } from "../source-intelligence/FanOutLink";
import { SourceGapSheet } from "../source-gap/SourceGapSheet";
import { sourceGapSummariesQueryOptions } from "../source-gap/sourceGapShared";
import { ROOT_CAUSE_LABELS } from "@/shared/source-gap";
import { HighlightedAnswerById } from "../ai-visibility/HighlightedAnswerLoader";
import { citationGapsKey, type CitationGapFilters } from "./citationGapsShared";

const PRIORITY_VARIANT = {
  high: "destructive",
  medium: "secondary",
  low: "outline",
} as const;

function AnswersSheet({
  projectId,
  finding,
  open,
  onOpenChange,
}: {
  projectId: string;
  finding: CitationGapFinding;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [index, setIndex] = useState(0);
  const id = finding.answerIds[index];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto data-[side=right]:sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle className="pr-8">{finding.title}</SheetTitle>
          <SheetDescription>
            Answer {index + 1} of {finding.answerIds.length} behind this
            finding, as collected.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-wrap items-center gap-2 px-4">
          <Button
            size="sm"
            variant="outline"
            disabled={index === 0}
            onClick={() => setIndex(index - 1)}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={index >= finding.answerIds.length - 1}
            onClick={() => setIndex(index + 1)}
          >
            Next
          </Button>
          {id ? <FanOutLink projectId={projectId} answer={id} /> : null}
        </div>
        <div className="px-4 pb-6">
          {id ? (
            <HighlightedAnswerById projectId={projectId} observationId={id} />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function GapFindingCard({
  projectId,
  filters,
  finding,
}: {
  projectId: string;
  filters: CitationGapFilters;
  finding: CitationGapFinding;
}) {
  const [answersOpen, setAnswersOpen] = useState(false);
  const [gapPrompt, setGapPrompt] = useState<{
    id: string;
    text: string;
  } | null>(null);
  const queryClient = useQueryClient();
  const summaries = useQuery(sourceGapSummariesQueryOptions(projectId));
  const create = useMutation({
    mutationFn: () =>
      createCitationGapOpportunity({
        data: { projectId, ...filters, findingKey: finding.key },
      }),
    onSuccess: (result) => {
      if (!result.ok) toast.error(result.reason);
      else toast.success("Added to Search Opportunities.");
      void queryClient.invalidateQueries({
        queryKey: citationGapsKey(projectId),
      });
    },
  });
  return (
    <li className="space-y-3 rounded-xl border bg-card p-4 md:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{GAP_TYPE_LABELS[finding.type]}</Badge>
        <Badge variant={PRIORITY_VARIANT[finding.priority]}>
          {finding.priority} priority
        </Badge>
        {finding.uncertain ? (
          <Badge variant="outline" className="gap-1 text-warning">
            <AlertTriangle className="size-3" /> Small sample
          </Badge>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {finding.promptGroup}
        </span>
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{finding.title}</h3>
        <p className="text-sm text-muted-foreground">{finding.summary}</p>
        <p className="text-sm">
          <span className="font-medium">Suggested: </span>
          {finding.suggestedAction}
        </p>
      </div>
      <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
        {finding.factors.map((factor) => (
          <div key={factor.label} className="flex gap-1">
            <dt className="text-muted-foreground">{factor.label}:</dt>
            <dd>{factor.value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        Why this priority: {finding.priorityReason}
      </p>
      {finding.competitors.length ? (
        <p className="text-xs">
          <span className="text-muted-foreground">
            Competitors in these answers:{" "}
          </span>
          {finding.competitors
            .map((c) => `${c.name} (${c.answers})`)
            .join(", ")}
        </p>
      ) : null}
      {finding.sources.length ? (
        <p className="text-xs break-words">
          <span className="text-muted-foreground">Cited sources: </span>
          {finding.sources.map((s) => `${s.domain} (${s.answers})`).join(", ")}
        </p>
      ) : null}
      {finding.uncertaintyNotes.length ? (
        <ul className="list-disc space-y-0.5 pl-4 text-xs text-warning">
          {finding.uncertaintyNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
      {finding.prompts.length ? (
        <div className="space-y-1.5 rounded-lg border border-dashed p-3">
          <p className="text-xs font-medium">Source Gap Analysis</p>
          <ul className="space-y-1.5">
            {finding.prompts.slice(0, 3).map((p) => {
              const done = summaries.data?.find(
                (s) => s.promptId === p.promptId,
              );
              return (
                <li
                  key={p.promptId}
                  className="flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <span className="min-w-0 flex-1 break-words">
                    {p.prompt}
                    {done?.topRootCause ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {ROOT_CAUSE_LABELS[done.topRootCause]}
                      </span>
                    ) : null}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setGapPrompt({ id: p.promptId, text: p.prompt })
                    }
                  >
                    {done ? "View analysis" : "Analyze cited pages"}
                  </Button>
                  <FanOutLink
                    projectId={projectId}
                    promptId={p.promptId}
                    days={filters.days}
                    promptGroup={filters.topic}
                    engines={filters.engines ?? undefined}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAnswersOpen(true)}
        >
          View {finding.answerIds.length} answer(s)
        </Button>
        {finding.action === null ? null : finding.opportunityId ? (
          <Button
            size="sm"
            variant="secondary"
            nativeButton={false}
            render={
              <Link
                to="/p/$projectId/opportunities"
                params={{ projectId }}
                search={{ opportunity: finding.opportunityId }}
              />
            }
          >
            Open opportunity
          </Button>
        ) : (
          <Button
            size="sm"
            pending={create.isPending}
            onClick={() => create.mutate()}
          >
            Create Search Opportunity
          </Button>
        )}
      </div>
      <AnswersSheet
        projectId={projectId}
        finding={finding}
        open={answersOpen}
        onOpenChange={setAnswersOpen}
      />
      {gapPrompt ? (
        <SourceGapSheet
          projectId={projectId}
          promptId={gapPrompt.id}
          prompt={gapPrompt.text}
          open
          onOpenChange={(open) => {
            if (!open) setGapPrompt(null);
          }}
        />
      ) : null}
    </li>
  );
}
