import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/client/components/ui/sheet";
import { AI_ENGINE_LABELS } from "@/shared/ai-visibility";
import { AI_PROMPT_INTENT_LABELS } from "@/shared/ai-prompt-intent";
import type {
  AiVisibilityIntelligence,
  IntelPromptEvidence,
} from "@/shared/ai-visibility-intelligence";
import { HighlightedAnswerById } from "../HighlightedAnswerLoader";
import { EngineIcon } from "../EngineIcon";
import { AiLoading, AiQueryError } from "../shared";
import {
  insightsEvidenceQueryOptions,
  type InsightsFilters,
} from "./insightsShared";

type OpenAnswer = {
  observationId: string;
  prompt: string;
  engine: IntelPromptEvidence["answers"][number]["engine"];
};

function AnswerChip({
  answer,
  onOpen,
}: {
  answer: IntelPromptEvidence["answers"][number];
  onOpen: () => void;
}) {
  const verdict =
    answer.recommended === true
      ? "recommended"
      : answer.mentioned
        ? "named"
        : "not named";
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-muted"
        aria-label={`Open ${AI_ENGINE_LABELS[answer.engine]} answer from ${answer.collectedAt ? new Date(answer.collectedAt).toLocaleString() : "unknown time"}: ${verdict}${answer.cited ? ", cited" : ""}`}
      >
        <EngineIcon engine={answer.engine} className="size-3.5" aria-hidden />
        {answer.collectedAt
          ? new Date(answer.collectedAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })
          : "—"}
        <span
          className={
            answer.mentioned ? "text-foreground" : "text-muted-foreground"
          }
        >
          {verdict}
        </span>
        {answer.cited ? <span className="text-brand-text">cited</span> : null}
      </button>
    </li>
  );
}

export function InsightsEvidence({
  projectId,
  filters,
  data,
  brandDomain = data.evidence.brandDomain,
}: {
  projectId: string;
  filters: InsightsFilters;
  data: AiVisibilityIntelligence;
  brandDomain?: string | null;
}) {
  const [open, setOpen] = useState<OpenAnswer | null>(null);
  const query = useInfiniteQuery(
    insightsEvidenceQueryOptions(projectId, filters, {
      brand: brandDomain,
      promptSetVersionId: data.promptSet.selectedVersionId,
    }),
  );
  const prompts = query.data?.pages.flatMap((page) => page.prompts) ?? [];
  const brand = data.leaderboard.find((b) => b.domain === brandDomain);
  return (
    <section
      className="space-y-3 rounded-xl border bg-card p-4 md:p-6"
      aria-label="Prompt evidence"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">
          Evidence for {brand?.name ?? "this brand"}
        </h3>
        <p className="text-xs text-muted-foreground">
          Answers in this selection, by prompt. Open one to read it with
          highlights.
        </p>
      </div>
      {query.isPending ? (
        <AiLoading />
      ) : query.isError ? (
        <AiQueryError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      ) : prompts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No answered collections match these filters.
        </p>
      ) : (
        <ul className="divide-y">
          {prompts.map((prompt) => (
            <li key={prompt.promptId} className="space-y-2 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium break-words">
                    {prompt.prompt}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {prompt.topic}
                    {prompt.intent
                      ? ` · ${AI_PROMPT_INTENT_LABELS[prompt.intent]}`
                      : ""}
                    {prompt.branded ? " · branded" : ""}
                  </p>
                </div>
                <ul className="flex flex-wrap gap-2 text-xs">
                  {prompt.engines.map((e) => (
                    <li key={e.engine}>
                      <Badge
                        variant="outline"
                        size="sm"
                        className="gap-1 tabular-nums"
                      >
                        <EngineIcon
                          engine={e.engine}
                          className="size-3"
                          aria-hidden
                        />
                        named {e.mentions}/{e.answers}
                        {e.cited ? ` · cited ${e.cited}` : ""}
                        {e.recommended ? ` · rec. ${e.recommended}` : ""}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {prompt.answers.map((answer) => (
                  <AnswerChip
                    key={answer.observationId}
                    answer={answer}
                    onOpen={() =>
                      setOpen({
                        observationId: answer.observationId,
                        prompt: prompt.prompt,
                        engine: answer.engine,
                      })
                    }
                  />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage ? (
        <Button
          variant="outline"
          size="sm"
          disabled={query.isFetchingNextPage}
          onClick={() => {
            void query.fetchNextPage();
          }}
        >
          {query.isFetchingNextPage && (
            <Loader2 className="size-4 animate-spin" />
          )}
          Load more prompts
        </Button>
      ) : null}
      {query.isFetchNextPageError ? <AiQueryError error={query.error} /> : null}
      <Sheet
        open={open !== null}
        onOpenChange={(next) => !next && setOpen(null)}
      >
        <SheetContent className="w-full overflow-y-auto data-[side=right]:sm:max-w-3xl">
          {open ? (
            <>
              <SheetHeader>
                <SheetTitle className="pr-8">{open.prompt}</SheetTitle>
                <SheetDescription>
                  {AI_ENGINE_LABELS[open.engine]} answer, as collected
                </SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-6">
                <HighlightedAnswerById
                  projectId={projectId}
                  observationId={open.observationId}
                />
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </section>
  );
}
