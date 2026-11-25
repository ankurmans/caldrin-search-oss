import { captureClientEvent } from "@/client/lib/posthog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { QueryError } from "@/client/components/QueryState";
import { SkeletonCard } from "@/client/components/SkeletonPresets";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import type { Editor } from "@tiptap/react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { DraftReviewer } from "./DraftReviewer";
import { AiDraftAction } from "./AiDraftAction";
import { RichDraftCanvas } from "./RichDraftCanvas";
import { useWorkingDraft, savedFields } from "./useWorkingDraft";
import { SavedRevision } from "./SavedRevision";
import { downloadDraft } from "./draftExport";
import { DraftOutline } from "./DraftOutline";
import { DraftVersions } from "./DraftVersions";
import { GapAnswers } from "./GapAnswers";
import { DraftReview } from "./DraftReview";
import { findPlaceholders } from "@/server/features/content/rules/placeholders";
import { approveContentDraft } from "@/serverFunctions/content";
import {
  editContentDraft,
  getContentDraft,
} from "@/serverFunctions/contentEditorial";
import { ChangeFlow } from "./ChangeFlow";
import {
  draftKey,
  invalidateContent,
  unwrap,
  type DraftDetail,
} from "./helpers";

export function DraftEditor({
  projectId,
  assetId,
  revision,
  initiallyOpenWriter,
  onClose,
}: {
  projectId: string;
  assetId: string;
  revision?: number;
  initiallyOpenWriter?: boolean;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: draftKey(projectId, assetId),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      const result = await getContentDraft({ data: { projectId, assetId } });
      if (!result.ok) throw new Error(result.reason);
      return result.data;
    },
  });
  if (query.isLoading) return <SkeletonCard />;
  if (query.isError || !query.data) {
    return (
      <QueryError
        error={query.error}
        fallback="Could not load the draft."
        onRetry={() => void query.refetch()}
        isRetrying={query.isFetching}
      />
    );
  }
  if (revision !== undefined) {
    const version = query.data.versions.find(
      (item) => item.revision === revision,
    );
    return (
      <SavedRevision
        version={version}
        revision={revision}
        projectId={projectId}
        assetId={assetId}
        onClose={onClose}
      />
    );
  }
  return (
    <DraftForm
      key={query.data.asset.revision}
      projectId={projectId}
      detail={query.data}
      initiallyOpenWriter={initiallyOpenWriter}
      onClose={onClose}
    />
  );
}

function DraftForm({
  projectId,
  detail,
  initiallyOpenWriter,
  onClose,
}: {
  projectId: string;
  detail: DraftDetail;
  initiallyOpenWriter?: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { asset, checks } = detail;
  const { fields, dirty, recovery, restore, remember, set, clear } =
    useWorkingDraft(projectId, asset);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [restoreConflict, setRestoreConflict] = useState(false);
  const [reload, setReload] = useState(false);
  const approvedHere = asset.approvedRevision === asset.revision;
  const published = asset.status === "published";
  const refresh = () =>
    void invalidateContent(queryClient, projectId, asset.id);
  const save = useMutation({
    mutationFn: () =>
      editContentDraft({
        data: {
          projectId,
          assetId: asset.id,
          expectedRevision: asset.revision,
          ...fields,
        },
      }),
    onSuccess: (result) => {
      if (unwrap(result)) {
        captureClientEvent("content_studio:revision_saved", {
          projectId,
          assetId: asset.id,
          revision: asset.revision + 1,
        });
        clear();
        setRestoreConflict(false);
        refresh();
      } else if (!result.ok && result.reason.includes("draft changed")) {
        setRestoreConflict(true);
      }
    },
    onError: () =>
      toast.error(
        "Could not save the revision. Your working copy is still open.",
      ),
  });
  const approve = useMutation({
    mutationFn: () =>
      approveContentDraft({
        data: {
          projectId,
          assetId: asset.id,
          expectedRevision: asset.revision,
        },
      }),
    onSuccess: (result) => {
      if (unwrap(result)) {
        captureClientEvent("content_studio:revision_approved", {
          projectId,
          assetId: asset.id,
          revision: asset.revision,
        });
        refresh();
      }
    },
    onError: () => toast.error("Could not approve this revision."),
  });
  const editable = !published && !save.isPending && !approve.isPending;
  return (
    <section className="mx-auto max-w-[1440px] space-y-4">
      <header className="space-y-2 border-b border-border pb-4">
        <Button size="sm" variant="ghost" onClick={onClose}>
          ← Content Studio
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold">Revision {asset.revision}</h1>
            <Badge variant="outline">{asset.status}</Badge>
            <span role="status" className="text-xs text-muted-foreground">
              {save.isPending
                ? "Saving…"
                : dirty
                  ? "Unsaved revision"
                  : "Saved"}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <AiDraftAction
              projectId={projectId}
              detail={detail}
              fields={fields}
              disabled={!editable}
              initiallyOpen={initiallyOpenWriter && asset.revision === 1}
              onApply={remember}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => downloadDraft(fields)}
            >
              Export HTML
            </Button>
            <Button
              size="sm"
              pending={save.isPending}
              disabled={
                !dirty ||
                !editable ||
                !fields.title.trim() ||
                !fields.metaTitle.trim() ||
                fields.bodyHtml.length > 100_000
              }
              onClick={() => save.mutate()}
            >
              Save as new revision
            </Button>
          </div>
        </div>
        {!published && (
          <DraftReviewer
            projectId={projectId}
            assetId={asset.id}
            reviewer={asset.reviewerUserId}
            onChange={refresh}
          />
        )}
        {restoreConflict ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <p>
              Someone saved a newer revision. Your edits are available in this
              browser.
            </p>
            <Button
              size="sm"
              variant="outline"
              pending={reload}
              onClick={async () => {
                setReload(true);
                await queryClient.refetchQueries({
                  queryKey: draftKey(projectId, asset.id),
                });
                setReload(false);
              }}
            >
              Open latest revision
            </Button>
          </div>
        ) : null}
        {recovery && editable ? (
          <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
            <p>
              Unsaved edits from revision {recovery.revision}. Review the
              current draft before loading this copy.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                restore();
              }}
            >
              Load earlier working copy
            </Button>
          </div>
        ) : null}
        {asset.importedFrom ? (
          <p className="text-xs text-muted-foreground">
            Imported {asset.createdAt.slice(0, 10)} ·{" "}
            <a
              href={asset.importedFrom}
              className="underline"
              target="_blank"
              rel="noreferrer"
            >
              Read original page
            </a>
            {asset.importWarning ? ` · ${asset.importWarning}` : ""}
          </p>
        ) : null}
        {dirty && approvedHere ? (
          <p className="text-xs text-warning-foreground">
            Saving your edits creates a revision that needs its own approval.
          </p>
        ) : null}
      </header>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(17rem,22rem)]">
        <div className="min-w-0 space-y-4">
          <label className="block space-y-1 text-xs font-medium">
            Title
            <Input
              value={fields.title}
              maxLength={200}
              disabled={!editable}
              className="h-11 text-lg font-semibold"
              onChange={(event) => set("title")(event.target.value)}
            />
          </label>
          <DraftOutline editor={editor} />
          <RichDraftCanvas
            html={fields.bodyHtml}
            editable={editable}
            onUpdate={set("bodyHtml")}
            onEditor={setEditor}
          />
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-xs font-medium">
              Meta title
              <Input
                value={fields.metaTitle}
                maxLength={120}
                disabled={!editable}
                onChange={(event) => set("metaTitle")(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-xs font-medium">
              Meta description
              <Input
                value={fields.metaDescription}
                maxLength={320}
                disabled={!editable}
                onChange={(event) => set("metaDescription")(event.target.value)}
              />
            </label>
          </div>
          <DraftVersions
            detail={detail}
            editable={editable}
            onLoad={(version) => remember(savedFields(version))}
          />
          {!dirty && detail.canPublish && !published ? (
            <GapAnswers
              key={asset.revision}
              projectId={projectId}
              assetId={asset.id}
              questions={findPlaceholders(asset.bodyHtml)}
            />
          ) : null}
          {detail.canPublish ? (
            dirty ? (
              <p className="text-xs text-muted-foreground">
                Save a revision to review publishing options.
              </p>
            ) : (
              <ChangeFlow projectId={projectId} detail={detail} />
            )
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                pending={approve.isPending}
                disabled={
                  dirty ||
                  approvedHere ||
                  published ||
                  checks.some(
                    (check) => check.severity === "block" && !check.passed,
                  )
                }
                onClick={() => approve.mutate()}
              >
                Approve revision {asset.revision}
              </Button>
              <p className="text-xs text-muted-foreground">
                {approvedHere
                  ? "Approved for export."
                  : "Save and resolve blocking checks before approval. Export HTML to publish on your site."}
              </p>
            </div>
          )}
          {detail.changes.length > 0 ? (
            <Link
              className="text-sm underline"
              to="/p/$projectId/changes"
              params={{ projectId }}
              search={{ change: detail.changes[0].id }}
            >
              View publication history in Change Ledger
            </Link>
          ) : null}
        </div>
        <DraftReview
          detail={detail}
          editor={editor}
          html={fields.bodyHtml}
          dirty={dirty}
          editable={editable}
        />
      </div>
    </section>
  );
}
