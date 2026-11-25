import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/client/components/ui/alert-dialog";
import { Button } from "@/client/components/ui/button";
import { removeAiResearchKeyword } from "@/serverFunctions/ai-visibility";
import { aiResearchKeywordsQueryOptions } from "./shared";

export function RemoveKeywordButton({
  projectId,
  keyword,
}: {
  projectId: string;
  keyword: string;
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => removeAiResearchKeyword({ data: { projectId, keyword } }),
    onSuccess: async ({ removed }) => {
      setOpen(false);
      if (!removed) toast.message("That keyword was already removed.");
      else toast.success(`Removed "${keyword}".`);
      await queryClient.invalidateQueries({
        queryKey: aiResearchKeywordsQueryOptions(projectId).queryKey,
      });
    },
    onError: () => toast.error("Could not remove the keyword. Try again."),
  });

  return (
    <>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={`Delete keyword ${keyword}`}
        onClick={(event) => {
          // The row opens the keyword; this must not.
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <Trash2 className="size-4" />
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!remove.isPending) setOpen(next);
        }}
      >
        <AlertDialogContent onClick={(event) => event.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this keyword?</AlertDialogTitle>
            <AlertDialogDescription>
              "{keyword}" is removed from your Prompt Research list. Prompts you
              already track are not changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              Cancel
            </AlertDialogCancel>
            <Button
              variant="destructive"
              pending={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
