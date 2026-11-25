import { useMutation, useQuery } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { Textarea } from "@/client/components/ui/textarea";
import { unwrap } from "@/client/features/content/helpers";
import { organizationContextQueryOptions } from "@/client/features/team/organizationQueries";
import { hasOrgPermission } from "@/lib/org-permissions";
import { draftProjectContext } from "@/serverFunctions/projectContext";
import type { ProjectContextSectionKey } from "@/types/schemas/projectContext";

// Drafts every empty field from the website. The text goes into the form
// unsaved; the person reads it and saves it like anything they typed.
export function ContextDraftPanel({
  projectId,
  emptyKeys,
  onDrafted,
}: {
  projectId: string;
  emptyKeys: ProjectContextSectionKey[];
  onDrafted: (written: Record<string, string>) => void;
}) {
  // Drafting spends a few cents, so it is offered to the people who can spend.
  const org = useQuery(organizationContextQueryOptions());
  const canDraft = org.data
    ? hasOrgPermission(org.data.role, { integration: ["manage"] })
    : false;
  const [notes, setNotes] = React.useState("");
  // A website cannot say what the goal is; that field needs the notes.
  const askable = emptyKeys.filter(
    (key) => key !== "current_goal" || notes.trim(),
  );
  const draft = useMutation({
    mutationFn: () =>
      draftProjectContext({
        data: { projectId, fields: askable, notes: notes.trim() || undefined },
      }),
    onSuccess: (result) => {
      const written = unwrap(result);
      if (!written) return;
      onDrafted(
        Object.fromEntries(written.drafts.map((d) => [d.section, d.content])),
      );
      toast.success(
        `Drafted ${written.drafts.length} ${written.drafts.length === 1 ? "field" : "fields"}. Read them, change what is off, then save.`,
      );
    },
    onError: (error) => toast.error(error.message),
  });

  if (!canDraft) return null;
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3">
      <div className="space-y-0.5">
        <p className="text-sm font-medium text-foreground">
          Draft the empty fields with AI
        </p>
        <p className="text-xs text-muted-foreground">
          Reads your website and writes a first draft of every empty field
          below. Nothing is saved until you save it. Fields you have filled in
          are left alone.
        </p>
      </div>
      <Textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        rows={2}
        maxLength={1500}
        aria-label="Anything the AI should know"
        placeholder="Optional: anything it should know, such as what you are aiming for this quarter. A goal is only drafted from what you write here."
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        pending={draft.isPending}
        disabled={askable.length === 0}
        onClick={() => draft.mutate()}
      >
        {askable.length === 0
          ? "Every field is filled in"
          : "Draft from my website"}
      </Button>
    </div>
  );
}
