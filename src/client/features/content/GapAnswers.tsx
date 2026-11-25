import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { answerDraftGaps } from "@/serverFunctions/content";
import { invalidateContent, unwrap } from "./helpers";

// The gaps a draft leaves for facts only the store owner knows. Answers fill
// the draft and are remembered for later drafts.
export function GapAnswers({
  projectId,
  assetId,
  questions,
}: {
  projectId: string;
  assetId: string;
  questions: string[];
}) {
  const queryClient = useQueryClient();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const filled = questions.flatMap((question) => {
    const answer = answers[question]?.trim();
    return answer ? [{ question, answer }] : [];
  });
  const save = useMutation({
    mutationFn: () =>
      answerDraftGaps({ data: { projectId, assetId, answers: filled } }),
    onSuccess: (result) => {
      if (unwrap(result)) {
        void invalidateContent(queryClient, projectId, assetId);
      }
    },
  });
  if (questions.length === 0) return null;
  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div>
        <h3 className="text-sm font-medium">Facts the draft is missing</h3>
        <p className="text-xs text-muted-foreground">
          Answer once. Each answer goes into the draft and is saved under
          Merchant facts on the Context page, so later drafts use it.
        </p>
      </div>
      {questions.map((question) => (
        <label key={question} className="block space-y-1 text-xs">
          <span>{question}</span>
          <Input
            maxLength={500}
            value={answers[question] ?? ""}
            onChange={(event) =>
              setAnswers((current) => ({
                ...current,
                [question]: event.target.value,
              }))
            }
          />
        </label>
      ))}
      <Button
        size="sm"
        pending={save.isPending}
        disabled={filled.length === 0}
        onClick={() => save.mutate()}
      >
        Fill in and remember
      </Button>
    </div>
  );
}
