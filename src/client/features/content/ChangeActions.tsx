import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Input } from "@/client/components/ui/input";
import { toast } from "sonner";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { Button } from "@/client/components/ui/button";
import {
  approveShopifyChange,
  executeShopifyChange,
  proposeShopifyChange,
  type ContentResult,
} from "@/serverFunctions/content";
import {
  invalidateContent,
  unwrap,
  type LedgerChange,
  type ShopifyActionName,
} from "./helpers";
import type { Preview } from "./ProposedChangePanel";

const RUN_LABELS: Record<ShopifyActionName, string> = {
  create_draft: "Create Shopify draft",
  update_existing: "Update article in Shopify",
  publish_draft: "Publish",
};

const CONFIRM_TEXT: Record<ShopifyActionName, string> = {
  create_draft: "",
  update_existing:
    "This replaces the text of an existing Shopify article. If that article is published, the new text goes live immediately. You can roll it back afterwards.",
  publish_draft:
    "This makes the article public on the store. You can roll it back afterwards, which unpublishes it again.",
};

// Propose, approve, then run one Shopify change. Each button is the next step
// the ledger allows; the server refuses the rest and its reason is shown.
export function ChangeActions({
  projectId,
  assetId,
  action,
  targetExternalId,
  change,
  preview,
  previewError,
}: {
  projectId: string;
  assetId: string;
  action: ShopifyActionName;
  targetExternalId: string | undefined;
  change: LedgerChange | null;
  preview: Preview | null;
  previewError: boolean;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const done = (result: ContentResult<unknown>) => {
    setConfirming(false);
    if (result.ok) void invalidateContent(queryClient, projectId, assetId);
  };
  const propose = useMutation({
    mutationFn: () =>
      proposeShopifyChange({
        data: {
          projectId,
          assetId,
          action,
          targetExternalId,
          expectedDestination: preview?.draftDestination?.stamp,
        },
      }),
    onSuccess: (result) => {
      if (unwrap(result)) {
        toast.success("Change proposed. Review it, then approve it.");
        void invalidateContent(queryClient, projectId, assetId);
      }
    },
  });
  const approve = useMutation({
    mutationFn: (entryId: string) =>
      approveShopifyChange({ data: { projectId, entryId } }),
    onSuccess: (result) => {
      if (unwrap(result)) toast.success("Change approved.");
      done(result);
    },
  });
  const execute = useMutation({
    mutationFn: (input: {
      entryId: string;
      confirmUpdate: boolean;
      adoptExternalId?: string;
    }) =>
      executeShopifyChange({
        data: { projectId, targetExternalId, ...input },
      }),
    onSuccess: (result) => {
      if (unwrap(result)) toast.success("Done. The ledger has the record.");
      done(result);
    },
    // A Shopify failure is recorded on the ledger entry: show it.
    onSettled: () => {
      void invalidateContent(queryClient, projectId, assetId);
    },
  });

  const blocked = preview?.blocked ?? false;
  const needsConfirm = action !== "create_draft" || !!preview?.goesPublic;
  const run = () => {
    if (change) {
      execute.mutate({
        entryId: change.id,
        confirmUpdate: action === "update_existing",
      });
    }
  };

  if (
    preview?.draftDestination &&
    change?.beforeState?.startsWith("Shopify draft destination\n") &&
    !change.beforeState.endsWith(` ${preview.draftDestination.stamp}`)
  ) {
    return (
      <p role="alert" className="text-sm text-destructive">
        The store or blog changed after this proposal. Save a new revision and
        propose it for the destination shown above.
      </p>
    );
  }

  if (!change) {
    return (
      <div className="space-y-1">
        <Button
          size="sm"
          pending={propose.isPending}
          disabled={previewError || blocked || !preview}
          onClick={() => propose.mutate()}
        >
          Propose change
        </Button>
        <p className="text-xs text-muted-foreground">
          Proposing writes nothing to Shopify. It records exactly what you see
          above in the Change Ledger.
        </p>
      </div>
    );
  }
  if (change.status === "proposed" || change.status === "failed") {
    return (
      <div className="space-y-1">
        {change.status === "failed" ? (
          <p role="alert" className="text-xs text-destructive">
            The last attempt failed: {change.error ?? "unknown error"}. Nothing
            was changed that the ledger does not show. Approve again to retry.
          </p>
        ) : null}
        <Button
          size="sm"
          pending={approve.isPending}
          disabled={blocked}
          onClick={() => approve.mutate(change.id)}
        >
          {change.status === "failed" ? "Approve again to retry" : "Approve"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Only organization owners and admins can approve. Approval applies to
          revision {change.contentRevision} only: editing the draft clears it.
        </p>
      </div>
    );
  }
  if (change.status === "approved") {
    return (
      <>
        <Button
          size="sm"
          pending={execute.isPending}
          onClick={() => (needsConfirm ? setConfirming(true) : run())}
        >
          {RUN_LABELS[action]}
        </Button>
        {action === "create_draft" ? (
          <AdoptArticle
            pending={execute.isPending}
            onAdopt={(adoptExternalId) =>
              execute.mutate({
                entryId: change.id,
                confirmUpdate: false,
                adoptExternalId,
              })
            }
          />
        ) : null}
        {confirming ? (
          <ConfirmDialog
            title={`${RUN_LABELS[action]}?`}
            confirmLabel={RUN_LABELS[action]}
            pending={execute.isPending}
            onClose={() => setConfirming(false)}
            onConfirm={run}
          >
            {CONFIRM_TEXT[action] ||
              "This makes the article public on the store."}
          </ConfirmDialog>
        ) : null}
      </>
    );
  }
  if (change.status === "executing") {
    return (
      <div className="flex items-center gap-2">
        <p className="text-xs text-muted-foreground">
          Running in Shopify. Refresh in a moment.
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void invalidateContent(queryClient, projectId, assetId)
          }
        >
          Refresh
        </Button>
      </div>
    );
  }
  return null;
}

// Shopify may have made the article even though its answer never arrived.
// Approve the change first, then paste the article's number from its Shopify
// admin address to use it instead of creating another.
function AdoptArticle({
  pending,
  onAdopt,
}: {
  pending: boolean;
  onAdopt: (articleId: string) => void;
}) {
  const [id, setId] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <Input
        className="h-8 w-56"
        placeholder="Article number in Shopify"
        value={id}
        onChange={(event) => setId(event.target.value.trim())}
      />
      <Button
        size="sm"
        variant="outline"
        pending={pending}
        disabled={id === ""}
        onClick={() => onAdopt(id)}
      >
        Use this article
      </Button>
    </div>
  );
}
