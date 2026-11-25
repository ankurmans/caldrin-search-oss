import { useId, useState, type ReactNode } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Field, FieldLabel } from "@/client/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Textarea } from "@/client/components/ui/textarea";
import {
  AI_PROMPT_INTENT_LABELS,
  AI_PROMPT_INTENTS,
  type AiPromptIntent,
} from "@/shared/ai-prompt-intent";
import {
  estimateAiVisibilityCost,
  saveAiVisibilityTracker,
} from "@/serverFunctions/ai-visibility";
import type { AiTrackerPatch } from "@/types/schemas/ai-visibility";
import type { AiPrompt, AiTrackerState } from "@/shared/ai-visibility";
import { TopicField } from "./TopicField";
import { AiLoading, AiQueryError, aiVisibilityKey } from "./shared";

export function TrackerPatchReview({
  projectId,
  state,
  patch,
  children,
  canSave = true,
  onClose,
  onSaved,
}: {
  projectId: string;
  state: AiTrackerState;
  patch: AiTrackerPatch;
  /** Fields that edit the patch, such as its topic. */
  children?: ReactNode;
  /** False while those fields are incomplete. */
  canSave?: boolean;
  onClose: () => void;
  onSaved: (state: AiTrackerState) => void;
}) {
  const estimate = useQuery({
    queryKey: [...aiVisibilityKey(projectId), "changeEstimate", patch],
    queryFn: () => estimateAiVisibilityCost({ data: { projectId, patch } }),
    enabled: Boolean(state.tracker?.enabled),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
    // The estimate checks the change before Save, for example the topic
    // limit. Editing the patch in place keeps the last result instead of a
    // spinner, and Save waits for the new one.
    placeholderData: keepPreviousData,
  });
  const save = useMutation({
    mutationFn: () =>
      saveAiVisibilityTracker({ data: { projectId, ...patch } }),
    onSuccess: (result) => onSaved(result.state),
  });
  const needsEstimate = state.tracker?.enabled;
  const updatedWallet = estimate.data?.wallet;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader className="flex-row items-center justify-between gap-3">
          <DialogTitle className="text-lg">Review tracking change</DialogTitle>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={save.isPending}
            onClick={onClose}
            aria-label="Close review"
          >
            <X />
          </Button>
        </DialogHeader>
        {children}
        {patch.prompts?.map((prompt) => (
          <p
            key={prompt.id ?? prompt.text}
            className="rounded-lg bg-muted/60 p-3 text-sm whitespace-pre-wrap"
            data-ph-mask
          >
            {prompt.text}
          </p>
        ))}
        {needsEstimate && estimate.isPending ? (
          <AiLoading />
        ) : estimate.isError ? (
          <AiQueryError
            error={estimate.error}
            retry={() => {
              void estimate.refetch();
            }}
          />
        ) : (
          <>
            {updatedWallet?.enabled && (
              <p className="rounded-lg border p-3 text-sm">
                With this change, tracking can use up to{" "}
                {updatedWallet.scheduledCredits.toLocaleString()} credits per
                scheduled run and about{" "}
                {updatedWallet.monthlyCredits.toLocaleString()} per month.
              </p>
            )}
            {save.error && <AiQueryError error={save.error} />}
            <DialogFooter>
              <Button
                variant="ghost"
                disabled={save.isPending}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                disabled={
                  save.isPending || !canSave || estimate.isPlaceholderData
                }
                onClick={() => save.mutate()}
              >
                {save.isPending && <Loader2 className="size-4 animate-spin" />}
                Save change
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

const UNKNOWN = "__unknown";
const INTENT_ITEMS = [
  { value: UNKNOWN, label: "Not set" },
  ...AI_PROMPT_INTENTS.map((value) => ({
    value,
    label: AI_PROMPT_INTENT_LABELS[value],
  })),
];

export function PromptEditor({
  prompt,
  state,
  pending,
  onClose,
  onReview,
  onMove,
}: {
  prompt: AiPrompt;
  state: AiTrackerState;
  /** A move is saving. */
  pending: boolean;
  onClose: () => void;
  /** New wording adds a prompt, so its cost needs a review. */
  onReview: (patch: AiTrackerPatch) => void;
  /** A topic or intent change keeps the prompt and its answers, so it saves directly. */
  onMove: (patch: AiTrackerPatch) => void;
}) {
  const [text, setText] = useState(prompt.text);
  const [topic, setTopic] = useState(prompt.topic);
  const [intent, setIntent] = useState<AiPromptIntent | null>(prompt.intent);
  const textId = useId();
  const intentId = useId();
  // The server compares trimmed wording, so whitespace alone is no rewording.
  const reworded = text.trim() !== prompt.text;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-xl" showCloseButton={false}>
        <DialogHeader className="flex-row items-center justify-between gap-3">
          <DialogTitle className="text-lg">Edit prompt</DialogTitle>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close prompt editor"
          >
            <X />
          </Button>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor={textId}>Exact prompt</FieldLabel>
          <Textarea
            id={textId}
            className="min-h-28"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={2000}
            data-ph-mask
          />
        </Field>
        <TopicField topics={state.topics} value={topic} onChange={setTopic} />
        <Field>
          <FieldLabel htmlFor={intentId}>Buyer intent</FieldLabel>
          <Select
            items={INTENT_ITEMS}
            value={intent ?? UNKNOWN}
            onValueChange={(next) =>
              setIntent(AI_PROMPT_INTENTS.find((i) => i === next) ?? null)
            }
          >
            <SelectTrigger id={intentId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INTENT_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Optional. Visibility Insights can filter by it.
          </p>
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              pending ||
              !text.trim() ||
              !topic.trim() ||
              (!reworded && topic === prompt.topic && intent === prompt.intent)
            }
            onClick={() => {
              const patch = {
                prompts: [{ id: prompt.id, text, topic, intent }],
              };
              if (reworded) onReview(patch);
              else onMove(patch);
            }}
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            {reworded ? "Review change" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
