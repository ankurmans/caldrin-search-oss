import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { Button } from "@/client/components/ui/button";
import { rollbackShopifyChange } from "@/serverFunctions/content";
import { invalidateContent, type LedgerChange } from "./helpers";

const LATER_EDITS = "The article was edited in Shopify after this change";

const EXPLANATION = {
  restore_previous_content:
    "This puts the article's previous text back in Shopify.",
  unpublish:
    "This unpublishes the article. It stays in the Shopify admin as a draft: Caldrin never deletes articles.",
  manual:
    "Shopify cannot restore this one automatically. You will be shown the exact previous text to put back by hand.",
  none: "",
} as const;

type Manual = { instructions: string; previous: Record<string, string> };

// Roll back one executed change. The overwrite choice only appears when the
// server refuses because the article was edited in Shopify afterwards.
export function RollbackControl({
  projectId,
  assetId,
  change,
  label,
}: {
  projectId: string;
  assetId: string;
  change: LedgerChange;
  label: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [laterEdits, setLaterEdits] = useState<string | null>(null);
  const [manual, setManual] = useState<Manual | null>(null);
  const finish = () => {
    setOpen(false);
    setLaterEdits(null);
    setManual(null);
    void invalidateContent(queryClient, projectId, assetId);
  };
  const rollback = useMutation({
    mutationFn: (choice: {
      overwriteLaterEdits?: boolean;
      manuallyRestored?: boolean;
    }) =>
      rollbackShopifyChange({
        data: { projectId, entryId: change.id, ...choice },
      }),
    onSuccess: (result) => {
      if (!result.ok) {
        if (result.reason.startsWith(LATER_EDITS)) {
          setOpen(false);
          setLaterEdits(result.reason);
        } else {
          toast.error(result.reason);
        }
        return;
      }
      if (result.data.status === "manual") {
        setOpen(false);
        setManual(result.data);
        return;
      }
      toast.success(result.data.note);
      finish();
    },
  });

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open ? (
        <ConfirmDialog
          title="Roll back this change?"
          confirmLabel="Roll back"
          destructive
          pending={rollback.isPending}
          onClose={() => setOpen(false)}
          onConfirm={() => rollback.mutate({})}
        >
          {EXPLANATION[change.rollbackKind]}
        </ConfirmDialog>
      ) : null}
      {laterEdits ? (
        <ConfirmDialog
          title="Overwrite later edits?"
          confirmLabel="Roll back and overwrite"
          destructive
          pending={rollback.isPending}
          onClose={() => setLaterEdits(null)}
          onConfirm={() => rollback.mutate({ overwriteLaterEdits: true })}
        >
          <span className="block whitespace-pre-wrap break-words">
            {laterEdits}
          </span>
        </ConfirmDialog>
      ) : null}
      {manual ? (
        <div className="basis-full space-y-2 rounded-lg border p-3 text-xs">
          <p className="font-medium">Restore this by hand in Shopify</p>
          <p className="text-muted-foreground">{manual.instructions}</p>
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2">
            {Object.entries(manual.previous)
              .map(([field, value]) => `${field}: ${value}`)
              .join("\n")}
          </pre>
          <div className="flex gap-2">
            <Button
              size="sm"
              pending={rollback.isPending}
              onClick={() => rollback.mutate({ manuallyRestored: true })}
            >
              I restored it by hand
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setManual(null)}>
              Not yet
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
