import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/client/components/ui/sheet";
import { EngineLabel } from "@/client/features/ai-visibility/EngineLabel";
import { HighlightedAnswerById } from "@/client/features/ai-visibility/HighlightedAnswerLoader";
import type { InsightsFilters } from "@/client/features/ai-visibility/insights/insightsShared";
import {
  AiLoading,
  AiQueryError,
  aiVisibilityKey,
} from "@/client/features/ai-visibility/shared";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { reviewAiPerception } from "@/serverFunctions/ai-perception";
import {
  PERCEPTION_OUTCOME_LABELS,
  PERCEPTION_SENTIMENTS,
  PERCEPTION_STANCES,
  type PerceptionSentiment,
  type PerceptionStance,
} from "@/shared/ai-perception";
import type { PerceptionCellAnswer } from "@/shared/ai-perception-view";
import { OUTCOME_TEXT, perceptionCellQueryOptions } from "./perceptionShared";

export interface CellTarget {
  domain: string;
  name: string;
  title: string;
  promptId?: string;
  topic?: string;
}

function Points({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-xs font-medium">{title}</p>
      <ul className="list-disc pl-5 text-sm text-muted-foreground">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}

function Correction({
  projectId,
  reading,
}: {
  projectId: string;
  reading: NonNullable<PerceptionCellAnswer["reading"]>;
}) {
  const queryClient = useQueryClient();
  const [stance, setStance] = useState<PerceptionStance>(reading.stance);
  const [sentiment, setSentiment] = useState<PerceptionSentiment>(
    reading.sentiment,
  );
  const save = useMutation({
    mutationFn: () =>
      reviewAiPerception({
        data: {
          projectId,
          perceptionId: reading.id,
          stance: stance === reading.stance ? undefined : stance,
          sentiment: sentiment === reading.sentiment ? undefined : sentiment,
        },
      }),
    onSuccess: () =>
      toast.success("Correction saved. The model reading is kept."),
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(error, "Could not save the correction"),
      ),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: aiVisibilityKey(projectId) }),
  });
  const unchanged =
    stance === reading.stance && sentiment === reading.sentiment;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <PickOne
        label="Stance"
        value={stance}
        items={PERCEPTION_STANCES}
        onChange={setStance}
      />
      <PickOne
        label="Sentiment"
        value={sentiment}
        items={PERCEPTION_SENTIMENTS}
        onChange={setSentiment}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={unchanged || save.isPending}
        onClick={() => save.mutate()}
      >
        Correct reading
      </Button>
    </div>
  );
}

function PickOne<T extends string>({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: T;
  items: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <label className="space-y-1 text-xs">
      <span className="block text-muted-foreground">{label}</span>
      <Select
        items={items.map((i) => ({ value: i, label: i }))}
        value={value}
        onValueChange={(next) => {
          const match = items.find((i) => i === next);
          if (match) onChange(match);
        }}
      >
        <SelectTrigger aria-label={label} className="h-9 min-w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i} value={i}>
              {i}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

export function AnswerCard({
  projectId,
  answer,
}: {
  projectId: string;
  answer: PerceptionCellAnswer;
}) {
  const [open, setOpen] = useState(false);
  const r = answer.reading;
  return (
    <li className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">
          <EngineLabel engine={answer.engine} />
        </span>
        <span className={OUTCOME_TEXT[answer.outcome]}>
          {PERCEPTION_OUTCOME_LABELS[answer.outcome]}
        </span>
        {answer.collectedAt ? (
          <span className="text-xs text-muted-foreground">
            {new Date(answer.collectedAt).toLocaleDateString()}
          </span>
        ) : null}
        {r?.reviewed ? <Badge variant="secondary">Corrected</Badge> : null}
        {r?.ambiguousName ? (
          <Badge variant="outline">Name may mean something else</Badge>
        ) : null}
      </div>
      {r ? (
        <>
          <p className="text-sm">
            <span className="font-medium">{r.stance}</span>, {r.sentiment} tone,{" "}
            {r.confidence} confidence.
          </p>
          {r.evidence ? (
            <blockquote className="border-l-2 pl-3 text-sm italic text-muted-foreground">
              “{r.evidence}”
            </blockquote>
          ) : null}
          <Points title="Strengths credited" items={r.strengths} />
          <Points title="Weaknesses stated" items={r.weaknesses} />
          <Points title="Objections raised" items={r.objections} />
          {r.comparisons.length ? (
            <p className="text-sm text-muted-foreground">
              Against{" "}
              {r.comparisons
                .map((c) => `${c.competitor} (${c.outcome.replace("_", " ")})`)
                .join(", ")}
              .
            </p>
          ) : null}
          <Correction projectId={projectId} reading={r} />
        </>
      ) : answer.outcome === "unread" ? (
        <p className="text-sm text-muted-foreground">
          This answer names the brand but has not been read yet.
        </p>
      ) : null}
      <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide full answer" : "Show full answer"}
      </Button>
      {open ? (
        <HighlightedAnswerById
          projectId={projectId}
          observationId={answer.observationId}
        />
      ) : null}
    </li>
  );
}

export function PerceptionCellSheet({
  projectId,
  filters,
  target,
  onClose,
}: {
  projectId: string;
  filters: InsightsFilters;
  target: CellTarget | null;
  onClose: () => void;
}) {
  const query = useQuery({
    ...perceptionCellQueryOptions(projectId, filters, {
      domain: target?.domain ?? "",
      promptId: target?.promptId,
      topic: target?.topic,
    }),
    enabled: target !== null,
  });
  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{target?.name}</SheetTitle>
          <SheetDescription>{target?.title}</SheetDescription>
        </SheetHeader>
        <div className="space-y-3 p-4">
          {query.isPending ? (
            <AiLoading />
          ) : query.isError ? (
            <AiQueryError
              error={query.error}
              retry={() => {
                void query.refetch();
              }}
            />
          ) : (
            <ul className="space-y-3">
              {query.data.answers.map((a) => (
                <AnswerCard
                  key={a.observationId}
                  projectId={projectId}
                  answer={a}
                />
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
