import { Sparkles } from "lucide-react";
import { captureClientEvent } from "@/client/lib/posthog";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { startEditorialDraft } from "@/serverFunctions/contentEditorial";
import { unwrap } from "./helpers";

export function StartDraft({
  projectId,
  opportunity,
  onOpen,
}: {
  projectId: string;
  opportunity?: { id: string; query: string; pageUrl: string | null };
  onOpen: (assetId: string, openWriter: boolean) => void;
}) {
  const [url, setUrl] = useState(opportunity?.pageUrl ?? "");
  const start = useMutation({
    mutationFn: (mode: "ai" | "blank" | "import") =>
      startEditorialDraft({
        data: {
          projectId,
          opportunityId: opportunity?.id,
          url: mode === "import" ? url.trim() : undefined,
        },
      }),
    onSuccess: (result, mode) => {
      const detail = unwrap(result);
      if (detail) {
        captureClientEvent("content_studio:draft_started", {
          projectId,
          assetId: detail.asset.id,
          opportunityId: opportunity?.id,
          imported: !!detail.asset.importedFrom,
        });
        onOpen(detail.asset.id, mode === "ai");
      }
    },
    onError: () => toast.error("Could not start the draft."),
  });
  return (
    <details
      open={opportunity ? true : undefined}
      className="rounded-xl border bg-card p-4"
    >
      <summary className="cursor-pointer text-sm font-semibold">
        {opportunity ? "Draft from finding" : "New draft"}
      </summary>
      {opportunity ? <p className="mt-2 text-sm">{opportunity.query}</p> : null}
      <Button
        className="mt-3"
        size="sm"
        disabled={start.isPending}
        onClick={() => start.mutate("ai")}
      >
        <Sparkles /> Write with AI
      </Button>
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (url.trim()) start.mutate("import");
        }}
      >
        <label className="min-w-0 grow text-xs">
          Import a page from your website
          <Input
            type="url"
            maxLength={2048}
            className="mt-1"
            placeholder="https://…"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <Button
          type="submit"
          size="sm"
          disabled={!url.trim() || start.isPending}
        >
          Import page
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={start.isPending}
          onClick={() => start.mutate("blank")}
        >
          Start blank or paste
        </Button>
      </form>
    </details>
  );
}
