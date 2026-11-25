import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { aiVisibilityKey } from "@/client/features/ai-visibility/shared";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { classifyAiVisibilitySentiment } from "@/serverFunctions/ai-visibility";
import type { AiPerceptionView } from "@/shared/ai-perception-view";

/** Reading is paid model work, so it starts only here, with the cost shown. */
export function ReadAnswersBar({
  projectId,
  view,
}: {
  projectId: string;
  view: AiPerceptionView;
}) {
  const queryClient = useQueryClient();
  const read = useMutation({
    mutationFn: async () => {
      let saved = 0;
      let remaining = 0;
      let costUsd = 0;
      for (const runId of view.unread.runIds) {
        const result = await classifyAiVisibilitySentiment({
          data: { projectId, runId },
        });
        saved += result.readingsSaved;
        remaining += result.remaining;
        costUsd += result.costUsd;
      }
      return { saved, remaining, costUsd };
    },
    onSuccess: ({ saved, remaining, costUsd }) => {
      toast.success(
        remaining
          ? `Read ${saved} brand mentions for $${costUsd.toFixed(3)}. ${remaining} more remain; run it again.`
          : `Read ${saved} brand mentions for $${costUsd.toFixed(3)}.`,
      );
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Reading did not finish")),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: aiVisibilityKey(projectId) }),
  });
  const count = view.unread.answers;
  if (!count) return null;
  const noun = count === 1 ? "answer" : "answers";
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-amber-300/60 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-amber-500/30 dark:bg-amber-500/10">
      <p className="text-sm">
        <span className="font-medium">
          {count} {noun}
        </span>{" "}
        {count === 1 ? "names" : "name"} a brand but{" "}
        {count === 1 ? "has" : "have"} not been read yet.{" "}
        {count === 1 ? "It shows" : "They show"} as “Named, not read yet” and{" "}
        {count === 1 ? "is" : "are"} left out of every recommended and negative
        rate until read. Reading costs{" "}
        {view.unread.estimateUsd < 0.01
          ? "less than 1 cent"
          : `up to about $${view.unread.estimateUsd.toFixed(2)}`}{" "}
        of model spend on your answer-engine key.
      </p>
      <Button
        onClick={() => read.mutate()}
        disabled={read.isPending}
        className="shrink-0"
      >
        {read.isPending ? <Spinner /> : null}
        Read {count} {noun}
      </Button>
    </section>
  );
}
