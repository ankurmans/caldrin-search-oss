import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Label } from "@/client/components/ui/label";
import { Textarea } from "@/client/components/ui/textarea";
import { rejectLedgerChange } from "@/serverFunctions/ledger";

const NO_REASON = "No reason given";

export function RejectDialog({
  projectId,
  entryId,
  onClose,
  onDone,
}: {
  projectId: string;
  entryId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () =>
      rejectLedgerChange({
        data: { projectId, entryId, reason: reason.trim() || NO_REASON },
      }),
    onSuccess: (result) => {
      if (!result.ok) {
        setRefusal(result.reason);
        toast.error(result.reason);
        return;
      }
      toast.success("Change rejected.");
      onDone();
      onClose();
    },
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reject this change?</DialogTitle>
          <DialogDescription>
            Nothing is published. The ledger keeps the entry, marked rejected,
            with your name and the reason below.
          </DialogDescription>
        </DialogHeader>
        {refusal ? (
          <Alert variant="destructive">
            <AlertDescription>{refusal}</AlertDescription>
          </Alert>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor="reject-reason">Reason (optional)</Label>
          <Textarea
            id="reject-reason"
            value={reason}
            maxLength={900}
            placeholder="Why this change should not go ahead"
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
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
            onClick={() => mutation.mutate()}
          >
            Reject change
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
