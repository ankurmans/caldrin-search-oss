import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { Label } from "@/client/components/ui/label";
import { Textarea } from "@/client/components/ui/textarea";
import type { LedgerEntry } from "@/server/features/ledger/types";
import { recordLedgerFinalDecision } from "@/serverFunctions/ledger";
import { ledgerEntryKey, unwrap } from "./helpers";

export function FinalDecision({
  projectId,
  entry,
}: {
  projectId: string;
  entry: LedgerEntry;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(entry.finalDecision ?? "");
  const save = useMutation({
    mutationFn: () =>
      recordLedgerFinalDecision({
        data: { projectId, entryId: entry.id, text: text.trim() },
      }),
    onSuccess: (result) => {
      if (!unwrap(result)) return;
      toast.success("Decision recorded.");
      setOpen(false);
      void queryClient.invalidateQueries({
        queryKey: ledgerEntryKey(projectId, entry.id),
      });
    },
  });
  const allowed = entry.status === "executed" || entry.status === "rolled_back";

  if (!open) {
    return (
      <div className="space-y-1">
        <Button
          size="sm"
          variant="outline"
          disabled={!allowed}
          onClick={() => setOpen(true)}
        >
          Record final decision
        </Button>
        {allowed ? null : (
          <p className="text-xs text-muted-foreground">
            A decision can be recorded once the change is executed or rolled
            back.
          </p>
        )}
      </div>
    );
  }
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <Label htmlFor="final-decision">Final decision</Label>
      <Textarea
        id="final-decision"
        rows={3}
        maxLength={2000}
        placeholder="For example: keep it, the recorded readings look steady."
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          pending={save.isPending}
          disabled={text.trim() === ""}
        >
          Save decision
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={save.isPending}
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
