import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { needsReviewNote } from "@/server/features/content/rules/shopifyReconcileRules";
import {
  markShopifyChangeNotApplied,
  reconcileShopifyChange,
} from "@/serverFunctions/content";
import { invalidateContent, type LedgerChange } from "./helpers";

// For a change stuck in "executing": the Worker may have died before it heard
// Shopify's answer. This only reads the store and records what it finds.
export function CheckWhatHappened({
  projectId,
  change,
}: {
  projectId: string;
  change: LedgerChange;
}) {
  const queryClient = useQueryClient();
  const refresh = () => {
    if (change.contentAssetId) {
      void invalidateContent(queryClient, projectId, change.contentAssetId);
    }
  };
  const check = useMutation({
    mutationFn: () =>
      reconcileShopifyChange({ data: { projectId, entryId: change.id } }),
    onSuccess: (result) => {
      if (!result.ok) toast.error(result.reason);
      else if (result.data.outcome === "needs_review") {
        toast.warning(result.data.note);
      } else toast.success(result.data.note);
      refresh();
    },
  });
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="outline"
        pending={check.isPending}
        onClick={() => check.mutate()}
      >
        Check what happened
      </Button>
      {needsReviewNote(change) !== null ? (
        <MarkNotApplied
          projectId={projectId}
          change={change}
          onDone={refresh}
        />
      ) : null}
    </div>
  );
}

// The store check could not settle it, so a person looks in Shopify. If the
// change is not there, recording it as failed lets it be approved again.
function MarkNotApplied({
  projectId,
  change,
  onDone,
}: {
  projectId: string;
  change: LedgerChange;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const mark = useMutation({
    mutationFn: () =>
      markShopifyChangeNotApplied({ data: { projectId, entryId: change.id } }),
    onSuccess: (result) => {
      if (!result.ok) toast.error(result.reason);
      else {
        setOpen(false);
        toast.success("Recorded as not applied. You can approve it again.");
      }
      onDone();
    },
  });
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        It's not in the store
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!mark.isPending) setOpen(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Record this change as not applied?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Only do this after checking the store's blog. If the article is
              there and you approve this change again, Shopify gets a second
              copy. Your name is kept on this change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mark.isPending}>
              Cancel
            </AlertDialogCancel>
            <Button
              variant="destructive"
              pending={mark.isPending}
              onClick={() => mark.mutate()}
            >
              Record as not applied
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
