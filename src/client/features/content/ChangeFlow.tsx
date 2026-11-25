import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { QueryError } from "@/client/components/QueryState";
import { SkeletonCard } from "@/client/components/SkeletonPresets";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import {
  getShopifyArticles,
  getShopifyChangePreview,
} from "@/serverFunctions/content";
import { ChangeActions } from "./ChangeActions";
import { ChangeSteps } from "./ChangeSteps";
import {
  findChange,
  previewKey,
  type DraftDetail,
  type ShopifyActionName,
} from "./helpers";
import {
  DiffView,
  ProposedChangePanel,
  type Preview,
} from "./ProposedChangePanel";
import { RollbackControl } from "./RollbackControl";

const ROLLBACK_LABELS: Record<ShopifyActionName, string> = {
  create_draft: "Roll back Shopify draft",
  update_existing: "Roll back update",
  publish_draft: "Roll back publish",
};

// An update entry's frozen before text starts with "Article: <id>".
function targetOfUpdate(beforeState: string | null | undefined) {
  return /^Article: (.+)$/m.exec(beforeState ?? "")?.[1] ?? null;
}

// Draft -> proposed change -> approval -> Shopify draft -> publish -> rollback,
// all read from the change ledger entries for this draft's current revision.
export function ChangeFlow({
  projectId,
  detail,
}: {
  projectId: string;
  detail: DraftDetail;
}) {
  const { asset, changes, checks } = detail;
  const revision = asset.revision;
  const existingUpdate = findChange(changes, "update_existing", revision);
  const [target, setTarget] = useState<string | null>(
    targetOfUpdate(existingUpdate?.beforeState),
  );
  const [choosing, setChoosing] = useState(false);

  const createDone =
    findChange(changes, "create_draft", revision)?.status === "executed";
  const action: ShopifyActionName = target
    ? "update_existing"
    : createDone
      ? "publish_draft"
      : "create_draft";
  const change = findChange(changes, action, revision);
  const finished = change?.status === "executed";
  const blocked = checks.some((c) => c.severity === "block" && !c.passed);

  const preview = useQuery({
    queryKey: [...previewKey(projectId, asset.id), action, target, revision],
    enabled: !finished && (action !== "update_existing" || !!target),
    queryFn: async (): Promise<Preview> => {
      const result = await getShopifyChangePreview({
        data: {
          projectId,
          assetId: asset.id,
          action,
          targetExternalId: target ?? undefined,
        },
      });
      if (!result.ok) throw new Error(result.reason);
      return result.data;
    },
  });

  const staleApproval =
    !change?.approvedAt &&
    changes.some(
      (c) =>
        c.approvedAt &&
        c.contentRevision !== null &&
        c.contentRevision < revision &&
        c.status !== "rolled_back",
    );
  const rollbacks = changes.filter(
    (c) =>
      c.contentRevision === revision &&
      c.status === "executed" &&
      c.rollbackKind !== "none",
  );

  return (
    <section className="space-y-4" aria-label="Publishing flow">
      <ChangeSteps
        projectId={projectId}
        changes={changes}
        revision={revision}
        path={target ? "update" : "new"}
        blocked={blocked}
      />
      {staleApproval ? (
        <Alert variant="warning">
          <AlertTitle>Approval cleared by your edit</AlertTitle>
          <AlertDescription>
            An earlier revision was approved. Approval covers one revision only,
            so revision {revision} needs its own proposal and approval before
            anything reaches Shopify.
          </AlertDescription>
        </Alert>
      ) : null}
      <UpdateTarget
        projectId={projectId}
        target={target}
        choosing={choosing}
        locked={action === "update_existing" && !!change}
        onChoosing={setChoosing}
        onTarget={setTarget}
      />
      {finished && change?.diff ? (
        <div className="space-y-1">
          <p className="text-xs font-medium">What was applied</p>
          <DiffView text={change.diff} unchanged={false} />
        </div>
      ) : null}
      {!finished && action === "update_existing" && !target ? (
        <p className="text-sm text-muted-foreground">
          Pick the article to update to see what would change.
        </p>
      ) : null}
      {!finished &&
      preview.isLoading &&
      (action !== "update_existing" || target) ? (
        <SkeletonCard />
      ) : null}
      {preview.isError && !finished ? (
        <QueryError
          error={preview.error}
          fallback="Could not build the proposed change."
          onRetry={() => void preview.refetch()}
          isRetrying={preview.isFetching}
          variant="inline"
        />
      ) : null}
      {preview.data && !finished ? (
        <ProposedChangePanel preview={preview.data} />
      ) : null}
      {finished || (action === "update_existing" && !target) ? null : (
        <ChangeActions
          projectId={projectId}
          assetId={asset.id}
          action={action}
          targetExternalId={target ?? undefined}
          change={change}
          preview={preview.data ?? null}
          previewError={preview.isError}
        />
      )}
      {rollbacks.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {rollbacks.map((entry) => (
            <RollbackControl
              key={entry.id}
              projectId={projectId}
              assetId={asset.id}
              change={entry}
              label={rollbackLabel(entry.idempotencyKey)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function rollbackLabel(key: string | null) {
  const part = (key ?? "").split(":")[3];
  if (part === "publish") return ROLLBACK_LABELS.publish_draft;
  if (part === "update") return ROLLBACK_LABELS.update_existing;
  return ROLLBACK_LABELS.create_draft;
}

// Updating an article that already exists is the less common path, so it sits
// behind a button and only loads the store's article list when opened.
function UpdateTarget({
  projectId,
  target,
  choosing,
  locked,
  onChoosing,
  onTarget,
}: {
  projectId: string;
  target: string | null;
  choosing: boolean;
  locked: boolean;
  onChoosing: (value: boolean) => void;
  onTarget: (value: string | null) => void;
}) {
  const articles = useQuery({
    queryKey: ["content-articles", projectId],
    enabled: choosing,
    queryFn: async () => {
      const result = await getShopifyArticles({ data: { projectId } });
      if (!result.ok) throw new Error(result.reason);
      return result.data;
    },
  });
  if (locked) return null;
  if (!choosing && !target) {
    return (
      <Button size="sm" variant="ghost" onClick={() => onChoosing(true)}>
        Update an existing Shopify article instead
      </Button>
    );
  }
  const items = (articles.data ?? []).map((a) => ({
    value: a.externalId,
    label: `${a.title}${a.isPublished ? " (published)" : " (draft)"}`,
  }));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {articles.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading articles…</p>
        ) : (
          <Select
            items={items}
            value={target}
            onValueChange={(value) => onTarget(value)}
          >
            <SelectTrigger
              size="sm"
              className="w-72 max-w-full"
              aria-label="Article to update"
            >
              <SelectValue placeholder="Pick the article to update" />
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            onTarget(null);
            onChoosing(false);
          }}
        >
          Back to a new article
        </Button>
      </div>
      {articles.isError ? (
        <QueryError
          error={articles.error}
          fallback="Could not load the store's articles."
          onRetry={() => void articles.refetch()}
          variant="inline"
        />
      ) : null}
      {!articles.isLoading && items.length === 0 && !articles.isError ? (
        <p className="text-xs text-muted-foreground">
          The store has no articles to update.
        </p>
      ) : null}
    </div>
  );
}
