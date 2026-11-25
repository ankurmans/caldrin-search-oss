import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { QueryError } from "@/client/components/QueryState";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { getErrorCode } from "@/client/lib/error-messages";
import { saveKeywords, seedKeywords } from "@/serverFunctions/keywords";

const SEED_TAG = "From my site";
/** Ideas ticked when the list opens: the highest-volume ones. */
const PRESELECTED = 25;

type Idea = Awaited<ReturnType<typeof seedKeywords>>["keywords"][number];

/** "Seed keywords" button and dialog for the Saved Keywords page. */
export function SeedKeywordsButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Sparkles data-icon="inline-start" />
        Seed keywords
      </Button>
      {open ? (
        <SeedKeywordsDialog
          projectId={projectId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function SeedKeywordsDialog({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const find = useMutation({
    mutationFn: () => seedKeywords({ data: { projectId } }),
    // The error shows inline in the dialog.
    meta: { errorToast: false },
    onSuccess: ({ keywords }) =>
      setSelected(
        new Set(keywords.slice(0, PRESELECTED).map((idea) => idea.keyword)),
      ),
  });
  const save = useMutation({
    mutationFn: (ideas: Idea[]) =>
      saveKeywords({
        data: {
          projectId,
          keywords: ideas.map((idea) => idea.keyword),
          tags: [SEED_TAG],
          metrics: ideas.map((idea) => ({
            keyword: idea.keyword,
            searchVolume: idea.searchVolume,
            cpc: idea.cpc,
            competition: idea.competition,
            keywordDifficulty: idea.keywordDifficulty,
            intent: idea.intent,
          })),
        },
      }),
    onSuccess: (_, ideas) => {
      onClose();
      toast.success(
        `Saved ${ideas.length} keyword${ideas.length === 1 ? "" : "s"}`,
      );
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["savedKeywords", projectId] }),
  });

  const ideas = find.data?.keywords ?? [];
  const chosen = ideas.filter((idea) => selected.has(idea.keyword));
  const toggle = (keyword: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(keyword)) next.add(keyword);
      return next;
    });

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Seed keywords</DialogTitle>
          <DialogDescription>
            {find.data
              ? `Ideas for ${find.data.seeds.join(", ")}, ranked by monthly searches. Pick the ones worth tracking.`
              : "We take the topics from your website, look up related searches, and show their volume, difficulty and CPC. This uses a small amount of provider usage. Nothing is saved until you pick keywords."}
          </DialogDescription>
        </DialogHeader>

        {find.isError ? (
          <QueryError
            cause={find.error}
            fallback="We couldn't find keywords. Try again in a moment."
            variant="inline"
          />
        ) : null}

        {find.data ? (
          ideas.length ? (
            <div className="max-h-96 overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="w-8 p-2" />
                    <th className="p-2 font-medium">Keyword</th>
                    <th className="p-2 text-right font-medium">Volume</th>
                    <th className="p-2 text-right font-medium">Difficulty</th>
                    <th className="p-2 text-right font-medium">CPC</th>
                  </tr>
                </thead>
                <tbody>
                  {ideas.map((idea) => (
                    <tr key={idea.keyword} className="border-t">
                      <td className="p-2">
                        <Checkbox
                          aria-label={`Select ${idea.keyword}`}
                          checked={selected.has(idea.keyword)}
                          onCheckedChange={() => toggle(idea.keyword)}
                        />
                      </td>
                      <td className="p-2">{idea.keyword}</td>
                      <td className="p-2 text-right tabular-nums">
                        {idea.searchVolume?.toLocaleString() ?? "–"}
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {idea.keywordDifficulty ?? "–"}
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {idea.cpc == null ? "–" : `$${idea.cpc.toFixed(2)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Every idea we found is already saved, or too small to show.
            </p>
          )
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={find.isPending || save.isPending}
          >
            Cancel
          </Button>
          {find.data ? (
            <Button
              pending={save.isPending}
              disabled={chosen.length === 0}
              onClick={() => save.mutate(chosen)}
            >
              {`Save ${chosen.length} keyword${chosen.length === 1 ? "" : "s"}`}
            </Button>
          ) : // Trying again can't fix running out of the free test run.
          getErrorCode(find.error) === "TRIAL_ENDED" ? null : (
            <Button pending={find.isPending} onClick={() => find.mutate()}>
              {find.isError ? "Try again" : "Find keywords"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
