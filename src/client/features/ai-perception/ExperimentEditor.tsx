import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Textarea } from "@/client/components/ui/textarea";
import {
  aiVisibilityKey,
  AiLoading,
  AiQueryError,
} from "@/client/features/ai-visibility/shared";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  approveAiPerceptionExperiment,
  deleteAiPerceptionExperiment,
  loadAiPerceptionExperimentPage,
  replayAiPerceptionExperiment,
  saveAiPerceptionExperiment,
} from "@/serverFunctions/ai-perception";
import {
  EXPERIMENT_LIMITS,
  experimentCostPreview,
  type ExperimentPromptChoice,
  type PerceptionExperiment,
} from "@/shared/ai-perception-experiments";
import { ExperimentDiff } from "./ExperimentDiff";
import { ExperimentResults } from "./ExperimentResults";
import { perceptionExperimentQueryOptions } from "./perceptionShared";

function Form({
  projectId,
  experiment,
  prompts,
  onSaved,
}: {
  projectId: string;
  experiment: PerceptionExperiment | null;
  prompts: ExperimentPromptChoice[];
  onSaved: (id: string) => void;
}) {
  const [title, setTitle] = useState(experiment?.title ?? "");
  const pageAddressId = useId();
  const [sourceUrl, setSourceUrl] = useState(experiment?.sourceUrl ?? "");
  const [original, setOriginal] = useState(experiment?.originalText ?? "");
  const [edited, setEdited] = useState(experiment?.editedText ?? "");
  const [assumptions, setAssumptions] = useState(experiment?.assumptions ?? "");
  const [repeats, setRepeats] = useState(
    experiment?.repeats ?? EXPERIMENT_LIMITS.minRepeatsForVerdict,
  );
  const [chosen, setChosen] = useState<string[]>(
    experiment?.promptResults.map((p) => p.promptId) ?? [],
  );
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () =>
      saveAiPerceptionExperiment({
        data: {
          projectId,
          experimentId: experiment?.id,
          title,
          sourceUrl: sourceUrl.trim() || null,
          originalText: original,
          editedText: edited,
          assumptions,
          repeats,
          promptIds: chosen,
        },
      }),
    onSuccess: ({ id }) => {
      void queryClient.invalidateQueries({
        queryKey: aiVisibilityKey(projectId),
      });
      toast.success("Saved. Any earlier replay was cleared.");
      onSaved(id);
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not save")),
  });
  const [loaded, setLoaded] = useState<string | null>(null);
  const load = useMutation({
    mutationFn: () =>
      loadAiPerceptionExperimentPage({
        data: { projectId, url: sourceUrl.trim() },
      }),
    onSuccess: (page) => {
      if (!page.ok) return void toast.error(page.reason);
      setSourceUrl(page.url);
      // The edit starts as a copy, so only the changes need writing.
      if (!edited.trim() || edited === original) setEdited(page.text);
      setOriginal(page.text);
      setLoaded(
        `Loaded ${page.wordCount.toLocaleString()} words${page.title ? ` from “${page.title}”` : ""}. This is the page's visible text, so trim menus and footers if they are not part of what you are testing.`,
      );
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not load the page")),
  });
  const toggle = (id: string) =>
    setChosen((cur) =>
      cur.includes(id)
        ? cur.filter((x) => x !== id)
        : cur.length < EXPERIMENT_LIMITS.prompts
          ? [...cur, id]
          : cur,
    );
  const ready =
    title.trim() && original.trim() && edited.trim() && chosen.length > 0;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">Name</span>
          <Input
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <div className="grid gap-1.5 text-sm">
          <label className="font-medium" htmlFor={pageAddressId}>
            Page address
          </label>
          <div className="flex items-center gap-2">
            <Input
              id={pageAddressId}
              value={sourceUrl}
              placeholder="https://"
              onChange={(e) => setSourceUrl(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={!sourceUrl.trim() || load.isPending}
              onClick={() => load.mutate()}
            >
              {load.isPending ? "Loading…" : "Load page"}
            </Button>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">Page text as it stands</span>
          <Textarea
            rows={9}
            value={original}
            onChange={(e) => setOriginal(e.target.value)}
          />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">Proposed edit</span>
          <Textarea
            rows={9}
            value={edited}
            onChange={(e) => setEdited(e.target.value)}
          />
        </label>
      </div>
      {loaded ? (
        <p className="text-xs text-muted-foreground">{loaded}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Load a public page by its address, or paste text for a page that is
          not live yet.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Only the first {EXPERIMENT_LIMITS.pageChars.toLocaleString()} characters
        of each version are used.
      </p>
      {original.trim() || edited.trim() ? (
        <ExperimentDiff original={original} edited={edited} />
      ) : null}
      <label className="grid gap-1.5 text-sm">
        <span className="font-medium">Assumptions</span>
        <Textarea
          rows={3}
          value={assumptions}
          placeholder="For example: an engine would cite this page for this question."
          onChange={(e) => setAssumptions(e.target.value)}
        />
      </label>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          Prompts to replay (up to {EXPERIMENT_LIMITS.prompts})
        </legend>
        {prompts.length ? (
          <ul className="grid gap-1.5 text-sm">
            {prompts.map((p) => (
              <li key={p.promptId}>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={chosen.includes(p.promptId)}
                    onChange={() => toggle(p.promptId)}
                  />
                  <span>
                    {p.prompt}{" "}
                    <span className="text-muted-foreground">· {p.topic}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            This project has no prompts yet. Add prompts in Visibility first.
          </p>
        )}
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <span className="font-medium">Repeats per version</span>
        <select
          className="rounded-md border bg-background px-2 py-1"
          value={repeats}
          onChange={(e) => setRepeats(Number(e.target.value))}
        >
          {Array.from(
            { length: EXPERIMENT_LIMITS.repeats },
            (_, i) => i + 1,
          ).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          {EXPERIMENT_LIMITS.minRepeatsForVerdict}+ are needed to measure spread
        </span>
      </label>
      <Button disabled={!ready || save.isPending} onClick={() => save.mutate()}>
        {save.isPending
          ? "Saving…"
          : experiment
            ? "Save changes"
            : "Create experiment"}
      </Button>
    </div>
  );
}

export function ExperimentEditor({
  projectId,
  experimentId,
  prompts,
  onSelect,
}: {
  projectId: string;
  experimentId: string | null;
  prompts: ExperimentPromptChoice[];
  onSelect: (id: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    ...perceptionExperimentQueryOptions(projectId, experimentId ?? ""),
    enabled: !!experimentId,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: aiVisibilityKey(projectId) });
  const replay = useMutation({
    mutationFn: () =>
      replayAiPerceptionExperiment({
        data: { projectId, experimentId: experimentId ?? "" },
      }),
    onSuccess: (r) => {
      toast.success(
        `Replayed ${r.replays} of ${r.planned} answers for $${r.costUsd.toFixed(3)}`,
      );
      void refresh();
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Replay failed")),
  });
  const approve = useMutation({
    mutationFn: () =>
      approveAiPerceptionExperiment({
        data: { projectId, experimentId: experimentId ?? "" },
      }),
    onSuccess: () => {
      toast.success("Saved to Opportunities");
      void refresh();
      void queryClient.invalidateQueries({ queryKey: ["opportunities"] });
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not approve")),
  });
  const remove = useMutation({
    mutationFn: () =>
      deleteAiPerceptionExperiment({
        data: { projectId, experimentId: experimentId ?? "" },
      }),
    onSuccess: () => {
      void refresh();
      onSelect(null);
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not delete")),
  });

  const experiment = query.data ?? null;
  if (experimentId && query.isPending) return <AiLoading />;
  if (experimentId && query.isError)
    return (
      <AiQueryError error={query.error} retry={() => void query.refetch()} />
    );
  if (experimentId && !experiment)
    return (
      <p className="text-sm text-muted-foreground">Experiment not found.</p>
    );
  const preview = experimentCostPreview(
    experiment?.promptResults.length ?? 0,
    experiment?.repeats ?? 0,
  );
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => onSelect(null)}>
          ← All experiments
        </Button>
        {experiment ? (
          <Badge variant="secondary">{experiment.status}</Badge>
        ) : null}
      </div>
      <Form
        key={`${experiment?.id ?? "new"}-${experiment?.replayedAt ?? ""}-${experiment?.createdAt ?? ""}`}
        projectId={projectId}
        experiment={experiment}
        prompts={prompts}
        onSaved={onSelect}
      />
      {experiment ? (
        <div className="space-y-3 border-t pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={replay.isPending} onClick={() => replay.mutate()}>
              {replay.isPending
                ? "Replaying…"
                : experiment.replayedAt
                  ? "Replay again"
                  : "Replay"}
            </Button>
            <span className="text-xs text-muted-foreground">
              Up to {preview.calls} model calls, about $
              {preview.estimatedUsd.toFixed(2)}. Your own provider key or trial
              budget pays for it.
            </span>
            {experiment.status === "replayed" ? (
              <Button
                variant="outline"
                disabled={approve.isPending}
                onClick={() => approve.mutate()}
              >
                Approve and send to Opportunities
              </Button>
            ) : null}
            {experiment.status === "approved" ? (
              <Link
                to="/p/$projectId/opportunities"
                params={{ projectId }}
                className="text-sm underline"
              >
                {experiment.approvedBy === "agent"
                  ? "Queued by an agent"
                  : "Approved"}{" "}
                · open Opportunities
              </Link>
            ) : null}
            <Button
              variant="ghost"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Delete
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Approving creates an opportunity for Content Studio to draft and
            publish through the usual review. After it is live, run a normal
            collection and compare on the Overview tab; that, not this replay,
            is the measurement.
          </p>
          <ExperimentResults experiment={experiment} />
        </div>
      ) : null}
    </section>
  );
}
