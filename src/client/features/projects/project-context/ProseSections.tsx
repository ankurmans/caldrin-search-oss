import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { EmptyState } from "@/client/components/EmptyState";
import { Button } from "@/client/components/ui/button";
import { Textarea } from "@/client/components/ui/textarea";
import { unwrap } from "@/client/features/content/helpers";
import { draftBrandVoice } from "@/serverFunctions/content";
import {
  PROJECT_CONTEXT_SECTION_KEYS,
  PROJECT_CONTEXT_SECTION_LABELS,
  PROSE_MAX_CHARS,
  type ProjectContextSectionKey,
} from "@/types/schemas/projectContext";
import { ContextDraftPanel } from "./ContextDraftPanel";
import {
  Provenance,
  useContextUpdate,
  type ProjectContextData,
} from "./shared";

const SECTION_HINTS: Record<ProjectContextSectionKey, string> = {
  business_overview: "What you sell, who buys it, and where.",
  current_goal: "What you're pushing for right now, and by when.",
  positioning: "Why someone picks you over the alternatives.",
  writing_preferences:
    "Voice, words to avoid, topics that are off-limits. The AI article writer follows this, along with your business overview and positioning.",
};

const SECTION_PLACEHOLDERS: Record<ProjectContextSectionKey, string> = {
  business_overview:
    "e.g. Booking software for independent restaurants in the US and Canada. Buyers are owner-operators, not marketers.",
  current_goal:
    "e.g. Double organic signups by Q4. Comparison pages are the current bet.",
  positioning:
    "e.g. The only booking tool that sets up in an afternoon. Cheaper than the incumbents, simpler than the DIY stack.",
  writing_preferences:
    "e.g. Plain and direct, no hype. Never say 'seamless' or 'game-changing'. Don't write about competitor pricing.",
};

export function ProseSections({
  projectId,
  sections,
  missingSections,
}: {
  projectId: string;
  sections: ProjectContextData["sections"];
  missingSections: ProjectContextData["missingSections"];
}) {
  const update = useContextUpdate(projectId);
  const stored = new Map(sections.map((section) => [section.key, section]));
  // Only the fields the user actually touched are pinned locally; the rest
  // render straight from the query, so a write from SAM shows up on refetch.
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});

  const draftOf = (key: ProjectContextSectionKey) =>
    drafts[key] ?? stored.get(key)?.content ?? "";

  // The guide is a suggestion: it lands in the box unsaved, below anything
  // already written, and counts as saved only when the person saves.
  const learnVoice = useMutation({
    mutationFn: () => draftBrandVoice({ data: { projectId } }),
    onSuccess: (result) => {
      const voice = unwrap(result);
      if (!voice) return;
      const existing = draftOf("writing_preferences").trim();
      setDrafts((current) => ({
        ...current,
        writing_preferences: (existing
          ? `${existing}\n\n${voice.guide}`
          : voice.guide
        ).slice(0, PROSE_MAX_CHARS),
      }));
    },
  });

  // What the AI wrote, kept to tell an untouched draft from one the person edited.
  const [aiDrafts, setAiDrafts] = React.useState<Record<string, string>>({});
  const emptyKeys = PROJECT_CONTEXT_SECTION_KEYS.filter(
    (key) => draftOf(key).trim() === "",
  );

  // Content is trimmed server-side, so compare trimmed values — otherwise a
  // stray newline leaves the form permanently "unsaved".
  const changed = PROJECT_CONTEXT_SECTION_KEYS.filter(
    (key) => draftOf(key).trim() !== (stored.get(key)?.content ?? ""),
  );

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (update.isPending || changed.length === 0) return;
    update.mutate(
      changed.map((key) => ({ section: key, content: draftOf(key).trim() })),
      // Unpin every draft the save made redundant — one that now matches the
      // server — so those sections render from the query again (a pinned
      // draft would silently overwrite a later agent write on the next
      // save). Anything typed while the request was in flight still differs
      // and stays pinned instead of snapping back.
      {
        onSuccess: (context) => {
          const saved = new Map<string, string>(
            context.sections.map((section) => [section.key, section.content]),
          );
          setDrafts((current) =>
            Object.fromEntries(
              Object.entries(current).filter(
                ([key, value]) => value.trim() !== (saved.get(key) ?? ""),
              ),
            ),
          );
        },
      },
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {missingSections.length === PROJECT_CONTEXT_SECTION_KEYS.length ? (
        <EmptyState
          size="sm"
          icon={null}
          title="Nothing written down yet"
          description="Fill in what you can — or ask your agent to draft it from your site and confirm what it got right."
        />
      ) : null}

      <ContextDraftPanel
        projectId={projectId}
        emptyKeys={emptyKeys}
        onDrafted={(written) => {
          setDrafts((current) => ({ ...current, ...written }));
          setAiDrafts((current) => ({ ...current, ...written }));
        }}
      />

      {PROJECT_CONTEXT_SECTION_KEYS.map((key) => {
        const section = stored.get(key);
        return (
          <div key={key} className="space-y-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <label
                htmlFor={`context-${key}`}
                className="text-sm font-medium text-foreground"
              >
                {PROJECT_CONTEXT_SECTION_LABELS[key]}
              </label>
              {section ? (
                <Provenance by={section.updatedBy} at={section.updatedAt} />
              ) : (
                <span className="text-xs text-muted-foreground">Empty</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {SECTION_HINTS[key]}
            </p>
            {aiDrafts[key] !== undefined && drafts[key] === aiDrafts[key] ? (
              <p className="text-xs text-muted-foreground">
                Drafted by AI from your website. Not saved yet.
              </p>
            ) : null}
            {key === "writing_preferences" ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                pending={learnVoice.isPending}
                onClick={() => learnVoice.mutate()}
              >
                Learn from your blog
              </Button>
            ) : null}
            <Textarea
              id={`context-${key}`}
              value={draftOf(key)}
              onChange={(event) => {
                const value = event.target.value;
                setDrafts((current) => {
                  // A draft that matches the store is no draft at all — drop
                  // it so an edit typed and then undone doesn't pin the
                  // section against later agent writes.
                  if (value === (stored.get(key)?.content ?? "")) {
                    const { [key]: _dropped, ...rest } = current;
                    return rest;
                  }
                  return { ...current, [key]: value };
                });
              }}
              rows={4}
              maxLength={PROSE_MAX_CHARS}
              placeholder={SECTION_PLACEHOLDERS[key]}
            />
          </div>
        );
      })}

      <div className="flex justify-end">
        <Button
          type="submit"
          size="sm"
          disabled={update.isPending || changed.length === 0}
        >
          Save changes
        </Button>
      </div>
    </form>
  );
}
