import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Textarea } from "@/client/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { useCostDisplay } from "@/client/features/spend/useCostDisplay";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  generateEditorialDraft,
  getEditorialDraftEstimate,
} from "@/serverFunctions/contentEditorial";
import { RichDraftCanvas } from "./RichDraftCanvas";
import type { DraftDetail } from "./helpers";
import type { Fields } from "./useWorkingDraft";

const ignore = () => {};

export function AiDraftAction({
  projectId,
  detail,
  fields,
  disabled,
  initiallyOpen = false,
  onApply,
}: {
  projectId: string;
  detail: DraftDetail;
  fields: Fields;
  disabled: boolean;
  initiallyOpen?: boolean;
  onApply: (fields: Fields) => void;
}) {
  const { asset, opportunity } = detail;
  const [open, setOpen] = useState(initiallyOpen);
  const title = fields.title === "Untitled draft" ? "" : fields.title;
  const [query, setQuery] = useState(
    opportunity?.query || asset.searchIntent || title,
  );
  const [guidance, setGuidance] = useState("");
  const [searchWeb, setSearchWeb] = useState(false);
  const { cost } = useCostDisplay();
  const topic = query.trim();
  const estimate = useQuery({
    queryKey: ["editorial-draft-estimate", projectId, topic],
    queryFn: () =>
      getEditorialDraftEstimate({ data: { projectId, query: topic } }),
    enabled: open && topic.length >= 3,
  });
  const generate = useMutation({
    mutationFn: async () => {
      const result = await generateEditorialDraft({
        data: {
          projectId,
          assetId: asset.id,
          expectedRevision: asset.revision,
          query: topic,
          guidance: guidance.trim() || undefined,
          bodyHtml: fields.bodyHtml,
          searchWeb,
        },
      });
      if (!result.ok) throw new Error(result.reason);
      return result.data;
    },
  });
  const estimateText = estimate.data
    ? cost(estimate.data.draftUsd + (searchWeb ? estimate.data.searchUsd : 0))
    : null;

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Sparkles /> Write with AI
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Write with AI</DialogTitle>
            <DialogDescription>
              Draft a whole article from your brief, project pages and available
              sources. Review it before applying.
            </DialogDescription>
          </DialogHeader>
          {generate.data ? (
            <div className="min-w-0 space-y-3">
              <p className="text-xs text-muted-foreground">
                {generate.data.internalLinks} internal pages and{" "}
                {generate.data.webSources} external sources available to the
                writer.
              </p>
              <h3 className="text-lg font-semibold">
                {generate.data.draft.title}
              </h3>
              <RichDraftCanvas
                html={generate.data.draft.bodyHtml}
                editable={false}
                onEditor={ignore}
                onUpdate={ignore}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={disabled}
                  onClick={() => {
                    if (!generate.data) return;
                    onApply(generate.data.draft);
                    generate.reset();
                    setOpen(false);
                  }}
                >
                  Use draft in editor
                </Button>
                <Button variant="outline" onClick={() => generate.reset()}>
                  Change instructions
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Using this draft replaces the working copy. Saved revisions
                remain available in version history.
              </p>
            </div>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (
                  topic.length >= 3 &&
                  !estimate.isPending &&
                  !estimate.isError
                )
                  generate.mutate();
              }}
            >
              <label className="block space-y-1 text-sm">
                Reader’s question or topic
                <Input
                  value={query}
                  maxLength={300}
                  required
                  disabled={generate.isPending}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <label className="block space-y-1 text-sm">
                Writing guidance (optional)
                <Textarea
                  value={guidance}
                  rows={3}
                  maxLength={1500}
                  disabled={generate.isPending}
                  onChange={(event) => setGuidance(event.target.value)}
                  placeholder="Audience, angle or details to cover"
                />
              </label>
              <label className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={searchWeb}
                  disabled={generate.isPending}
                  onChange={(event) => setSearchWeb(event.target.checked)}
                />
                <span>
                  <span className="block font-medium">
                    Search the web for sources
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Fetch Google results for this topic. Otherwise, the draft
                    uses sources already saved.
                  </span>
                </span>
              </label>
              {generate.isError ? (
                <p role="alert" className="text-sm text-destructive">
                  {getStandardErrorMessage(
                    generate.error,
                    generate.error.message,
                  )}
                </p>
              ) : null}
              {estimate.isError ? (
                <p role="alert" className="text-sm text-destructive">
                  The draft estimate is unavailable. Try again before
                  generating.
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="submit"
                  pending={generate.isPending}
                  disabled={
                    topic.length < 3 ||
                    estimate.isPending ||
                    estimate.isError ||
                    disabled
                  }
                >
                  Generate article
                </Button>
                {estimateText ? (
                  <p className="text-xs text-muted-foreground">
                    Estimated provider cost {estimateText}
                  </p>
                ) : null}
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
