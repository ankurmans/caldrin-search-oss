import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
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
import { Label } from "@/client/components/ui/label";
import type { LedgerEntry } from "@/server/features/ledger/types";
import { rollbackShopifyChange } from "@/serverFunctions/content";

type Outcome = Awaited<ReturnType<typeof rollbackShopifyChange>>;
type Manual = {
  instructions: string;
  previous: unknown;
};

export function RollbackDialog({
  projectId,
  entry,
  onClose,
  onDone,
}: {
  projectId: string;
  entry: LedgerEntry;
  onClose: () => void;
  onDone: () => void;
}) {
  const [overwrite, setOverwrite] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [manual, setManual] = useState<Manual | null>(null);
  const mutation = useMutation({
    mutationFn: (manuallyRestored: boolean) =>
      rollbackShopifyChange({
        data: {
          projectId,
          entryId: entry.id,
          overwriteLaterEdits: overwrite || undefined,
          manuallyRestored: manuallyRestored || undefined,
        },
      }),
    onSuccess: (result: Outcome) => {
      if (!result.ok) {
        setRefusal(result.reason);
        toast.error(result.reason);
        return;
      }
      setRefusal(null);
      if (result.data.status === "manual") {
        setManual({
          instructions: result.data.instructions,
          previous: result.data.previous,
        });
        return;
      }
      toast.success(result.data.note);
      onDone();
      onClose();
    },
  });
  const restores = entry.rollbackKind === "restore_previous_content";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Roll back this change?</DialogTitle>
          <DialogDescription>
            {restores
              ? "The text recorded before this change is written back to Shopify."
              : entry.rollbackKind === "unpublish"
                ? "The article is unpublished. It stays in Shopify as a draft; nothing is deleted."
                : "This change can only be undone by hand in Shopify."}{" "}
            The ledger keeps the entry and marks it rolled back.
          </DialogDescription>
        </DialogHeader>
        {refusal ? (
          <Alert variant="destructive">
            <AlertDescription className="whitespace-pre-wrap">
              {refusal}
            </AlertDescription>
          </Alert>
        ) : null}
        {manual ? (
          <ManualSteps manual={manual} />
        ) : restores ? (
          <div className="flex items-start gap-2">
            <Checkbox
              id="overwrite-later-edits"
              checked={overwrite}
              onCheckedChange={(checked) => setOverwrite(checked)}
            />
            <Label
              htmlFor="overwrite-later-edits"
              className="font-normal leading-snug"
            >
              Overwrite edits made in Shopify after this change. Without this,
              the rollback refuses if the article has moved on.
            </Label>
          </div>
        ) : null}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            pending={mutation.isPending}
            onClick={() => mutation.mutate(manual !== null)}
          >
            {manual ? "I restored it by hand, mark rolled back" : "Roll back"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManualSteps({ manual }: { manual: Manual }) {
  return (
    <div className="space-y-2">
      <p className="text-sm">{manual.instructions}</p>
      <pre
        tabIndex={0}
        className="max-h-48 overflow-auto rounded-lg border bg-muted/40 p-2 text-xs whitespace-pre-wrap break-words"
      >
        {JSON.stringify(manual.previous, null, 2)}
      </pre>
      <p className="text-xs text-muted-foreground">
        Shopify was not changed. Once you have put this text back, confirm
        below.
      </p>
    </div>
  );
}
