import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Label } from "@/client/components/ui/label";
import { organizationContextQueryOptions } from "@/client/features/team/organizationQueries";
import { hasOrgPermission } from "@/lib/org-permissions";
import type { LedgerEntry } from "@/server/features/ledger/types";
import {
  executeShopifyChange,
  approveShopifyChange,
} from "@/serverFunctions/content";
import { approveLedgerChange } from "@/serverFunctions/ledger";
import { RejectDialog } from "./RejectDialog";
import { RollbackDialog } from "./RollbackDialog";
import { ledgerEntryKey, spendKey, unwrap } from "./helpers";

// Approve, execute and roll back for one entry. Each button shows only when
// the entry's state allows it; the server re-checks every gate.
export function LedgerActions({
  projectId,
  entry,
}: {
  projectId: string;
  entry: LedgerEntry;
}) {
  const queryClient = useQueryClient();
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  // Only a manager sees Reject; the server re-checks the same permission.
  const org = useQuery(organizationContextQueryOptions());
  const isManager = org.data
    ? hasOrgPermission(org.data.role, { integration: ["manage"] })
    : false;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["ledger", projectId] });
    void queryClient.invalidateQueries({ queryKey: spendKey(projectId) });
    void queryClient.invalidateQueries({
      queryKey: ledgerEntryKey(projectId, entry.id),
    });
  };
  const isShopify = entry.provider === "shopify";

  const approve = useMutation({
    mutationFn: () =>
      isShopify
        ? approveShopifyChange({ data: { projectId, entryId: entry.id } })
        : approveLedgerChange({ data: { projectId, entryId: entry.id } }),
    onSuccess: (result) => {
      if (unwrap(result)) toast.success("Change approved.");
      refresh();
    },
  });
  const execute = useMutation({
    mutationFn: () =>
      executeShopifyChange({
        data: {
          projectId,
          entryId: entry.id,
          confirmUpdate: confirmUpdate || undefined,
        },
      }),
    onSuccess: (result) => {
      if (unwrap(result)) toast.success("Change executed.");
      refresh();
    },
  });

  const canApprove = entry.status === "proposed";
  const canReject = canApprove && isManager;
  const canExecute = isShopify && entry.status === "approved";
  const canRollback =
    isShopify && entry.status === "executed" && entry.rollbackKind !== "none";
  if (!canApprove && !canExecute && !canRollback) return null;
  const isUpdate = entry.kind === "content_article_update";

  return (
    <section
      aria-label="Actions"
      className="flex flex-wrap items-center gap-3 pt-4"
    >
      {canApprove ? (
        <Button
          size="sm"
          pending={approve.isPending}
          onClick={() => approve.mutate()}
        >
          Approve this change
        </Button>
      ) : null}
      {canReject ? (
        <Button size="sm" variant="outline" onClick={() => setRejectOpen(true)}>
          Reject
        </Button>
      ) : null}
      {canExecute ? (
        <>
          <Button
            size="sm"
            pending={execute.isPending}
            disabled={isUpdate && !confirmUpdate}
            onClick={() => execute.mutate()}
          >
            Execute in Shopify
          </Button>
          {isUpdate ? (
            <div className="flex items-center gap-2">
              <Checkbox
                id="confirm-update"
                checked={confirmUpdate}
                onCheckedChange={(checked) => setConfirmUpdate(checked)}
              />
              <Label htmlFor="confirm-update" className="font-normal">
                I confirm this overwrites an existing article.
              </Label>
            </div>
          ) : null}
        </>
      ) : null}
      {canRollback ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setRollbackOpen(true)}
        >
          Roll back
        </Button>
      ) : null}
      {rejectOpen ? (
        <RejectDialog
          projectId={projectId}
          entryId={entry.id}
          onClose={() => setRejectOpen(false)}
          onDone={refresh}
        />
      ) : null}
      {rollbackOpen ? (
        <RollbackDialog
          projectId={projectId}
          entry={entry}
          onClose={() => setRollbackOpen(false)}
          onDone={refresh}
        />
      ) : null}
    </section>
  );
}
