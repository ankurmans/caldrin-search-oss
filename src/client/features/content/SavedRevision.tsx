import { Link } from "@tanstack/react-router";
import { Button } from "@/client/components/ui/button";
import { RichDraftCanvas } from "./RichDraftCanvas";
import type { DraftDetail } from "./helpers";
import { downloadDraft } from "./draftExport";

const ignore = () => {};

export function SavedRevision({
  version,
  revision,
  projectId,
  assetId,
  onClose,
}: {
  version?: DraftDetail["versions"][number];
  revision: number;
  projectId: string;
  assetId: string;
  onClose: () => void;
}) {
  return (
    <section className="mx-auto max-w-4xl space-y-4">
      <Button size="sm" variant="ghost" onClick={onClose}>
        ← Content Studio
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Saved revision {revision}</h1>
        <div className="flex items-center gap-2">
          <Link
            to="/p/$projectId/content"
            params={{ projectId }}
            search={{ draft: assetId }}
            className="text-sm underline"
          >
            Open working draft
          </Link>
          {version ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => downloadDraft(version)}
            >
              Export HTML
            </Button>
          ) : null}
        </div>
      </div>
      {version ? (
        <>
          <p className="text-xl font-semibold">{version.title}</p>
          <RichDraftCanvas
            html={version.bodyHtml}
            editable={false}
            onUpdate={ignore}
            onEditor={ignore}
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          This exact revision is unavailable.
        </p>
      )}
    </section>
  );
}
